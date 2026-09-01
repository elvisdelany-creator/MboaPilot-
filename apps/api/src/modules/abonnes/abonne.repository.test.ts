import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerAbonne, rechercherAbonnes } from "./abonne.repository.js";
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
