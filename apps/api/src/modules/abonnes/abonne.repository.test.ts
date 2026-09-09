import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerAbonne, listerAbonnesEligiblesAnonymisationAutomatique, modifierAbonne, rechercherAbonnes, trouverAbonne } from "./abonne.repository.js";
import { recruterAbonne } from "../abonnements/recrutement.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let autreSiteId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
});

describe("rechercherAbonnes (4.5 : résolution unifiée id_abonne / numero_abonnement / nom / téléphone)", () => {
  it("trouve un abonné par son numéro d'abonné exact", () => {
    const ab = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });

    const resultats = rechercherAbonnes(db, siteId, String(ab.idAbonne));

    expect(resultats).toHaveLength(1);
    expect(resultats[0].idAbonne).toBe(ab.idAbonne);
  });

  it("trouve un abonné par le numéro d'un de ses abonnements", () => {
    const ab = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });
    const u = db
      .insert(schema.utilisateur)
      .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
      .returning()
      .get();
    const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    const formule = db
      .insert(schema.formule)
      .values({ idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 })
      .returning()
      .get();
    const sub = db
      .insert(schema.abonnement)
      .values({
        idAbonne: ab.idAbonne,
        idFormule: formule.idFormule,
        siteId,
        dateDebut: "2025-11-16",
        dateFin: "2025-12-15",
        creePar: u.idUser,
      })
      .returning()
      .get();

    const resultats = rechercherAbonnes(db, siteId, String(sub.numeroAbonnement));

    expect(resultats).toHaveLength(1);
    expect(resultats[0].idAbonne).toBe(ab.idAbonne);
  });

  it("trouve par correspondance partielle sur le nom", () => {
    creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });
    creerAbonne(db, { siteId, nom: "Mballa", prenom: "Sylvie", telephone: "691111111" });

    const resultats = rechercherAbonnes(db, siteId, "Ndongo");

    expect(resultats).toHaveLength(1);
    expect(resultats[0].nom).toBe("Nga Ndongo");
  });

  it("trouve par correspondance sur le téléphone", () => {
    creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });

    const resultats = rechercherAbonnes(db, siteId, "690000000");

    expect(resultats).toHaveLength(1);
    expect(resultats[0].telephone).toBe("690000000");
  });

  it("ne renvoie rien si aucune correspondance", () => {
    expect(rechercherAbonnes(db, siteId, "inconnu")).toHaveLength(0);
  });

  it("ne renvoie jamais un abonné d'un autre site (2.5.2)", () => {
    creerAbonne(db, { siteId: autreSiteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });

    expect(rechercherAbonnes(db, siteId, "Ndongo")).toHaveLength(0);
  });
});

describe("trouverAbonne (8.1)", () => {
  it("renvoie l'abonné correspondant", () => {
    const ab = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });

    expect(trouverAbonne(db, ab.idAbonne)?.nom).toBe("Nga Ndongo");
  });

  it("renvoie undefined pour un abonné inconnu", () => {
    expect(trouverAbonne(db, 999999)).toBeUndefined();
  });
});

describe("modifierAbonne (8.1 : consultation et modification de fiche abonné)", () => {
  it("met à jour les coordonnées fournies et conserve les autres champs", () => {
    const ab = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });

    const modifie = modifierAbonne(db, ab.idAbonne, { email: "valentin@example.cm", adresse: "Douala, Akwa" });

    expect(modifie.email).toBe("valentin@example.cm");
    expect(modifie.adresse).toBe("Douala, Akwa");
    expect(modifie.nom).toBe("Nga Ndongo"); // inchangé
    expect(modifie.telephone).toBe("690000000"); // inchangé
  });

  it("rejette un abonné inconnu", () => {
    expect(() => modifierAbonne(db, 999999, { email: "x@example.cm" })).toThrow(/introuvable/);
  });
});

// 11.3 : "durée de conservation définie et paramétrable, avec archivage ou
// anonymisation au-delà" — abonnés éligibles à l'anonymisation automatique
describe("listerAbonnesEligiblesAnonymisationAutomatique (11.3)", () => {
  let userId: number;
  let idFormule: number;

  beforeEach(() => {
    userId = db
      .insert(schema.utilisateur)
      .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" })
      .returning()
      .get().idUser;
    const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    idFormule = db.insert(schema.formule).values({ idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
  });

  it("signale un abonné dont le seul abonnement est expiré depuis plus longtemps que la durée de conservation", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga", prenom: "Valentin", telephone: "690000000" });
    db.insert(schema.abonnement)
      .values({ idAbonne: abonne.idAbonne, idFormule, siteId, dateDebut: "2020-01-01", dateFin: "2020-01-31", statut: "EXPIRE", creePar: userId })
      .run();

    const eligibles = listerAbonnesEligiblesAnonymisationAutomatique(db, "2026-01-01", 1095);

    expect(eligibles).toHaveLength(1);
    expect(eligibles[0].abonne.idAbonne).toBe(abonne.idAbonne);
    expect(eligibles[0].derniereActivite).toBe("2020-01-31");
  });

  it("ignore un abonné avec un abonnement encore ACTIF, même ancien", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga", prenom: "Valentin", telephone: "690000000" });
    db.insert(schema.abonnement)
      .values({ idAbonne: abonne.idAbonne, idFormule, siteId, dateDebut: "2020-01-01", dateFin: "2020-01-31", statut: "ACTIF", creePar: userId })
      .run();

    expect(listerAbonnesEligiblesAnonymisationAutomatique(db, "2026-01-01", 1095)).toHaveLength(0);
  });

  it("ignore un abonné dont la dernière expiration est trop récente", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga", prenom: "Valentin", telephone: "690000000" });
    db.insert(schema.abonnement)
      .values({ idAbonne: abonne.idAbonne, idFormule, siteId, dateDebut: "2025-11-01", dateFin: "2025-12-01", statut: "EXPIRE", creePar: userId })
      .run();

    expect(listerAbonnesEligiblesAnonymisationAutomatique(db, "2026-01-01", 1095)).toHaveLength(0);
  });

  it("ignore une fiche déjà anonymisée", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Anonymisé", prenom: "Anonymisé", telephone: "0000000000" });
    db.insert(schema.abonnement)
      .values({ idAbonne: abonne.idAbonne, idFormule, siteId, dateDebut: "2020-01-01", dateFin: "2020-01-31", statut: "EXPIRE", creePar: userId })
      .run();

    expect(listerAbonnesEligiblesAnonymisationAutomatique(db, "2026-01-01", 1095)).toHaveLength(0);
  });

  it("signale un abonné sans aucun abonnement, en s'appuyant sur sa date de création", () => {
    db.insert(schema.abonne).values({ siteId, nom: "Sans Abonnement", prenom: "X", telephone: "690000001", dateCreation: "2020-01-01" }).run();

    const eligibles = listerAbonnesEligiblesAnonymisationAutomatique(db, "2026-01-01", 1095);

    expect(eligibles).toHaveLength(1);
    expect(eligibles[0].derniereActivite).toBe("2020-01-01");
  });

  it("prend en compte l'abonnement le plus récent quand plusieurs existent", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga", prenom: "Valentin", telephone: "690000000" });
    db.insert(schema.abonnement)
      .values({ idAbonne: abonne.idAbonne, idFormule, siteId, dateDebut: "2018-01-01", dateFin: "2018-01-31", statut: "EXPIRE", creePar: userId })
      .run();
    db.insert(schema.abonnement)
      .values({ idAbonne: abonne.idAbonne, idFormule, siteId, dateDebut: "2025-11-01", dateFin: "2025-12-01", statut: "EXPIRE", creePar: userId })
      .run();

    expect(listerAbonnesEligiblesAnonymisationAutomatique(db, "2026-01-01", 1095)).toHaveLength(0); // le plus récent (2025-12-01) est trop proche
  });
});
