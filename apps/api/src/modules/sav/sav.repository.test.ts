import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerDossierSav, listerDossiersSav, listerHistoriqueSav, trouverDossierSav } from "./sav.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "TECHNICIEN_SAV" })
    .returning()
    .get().idUser;
});

describe("creerDossierSav (5.10, 8.4)", () => {
  it("ouvre un dossier au statut RECU, sans abonné rattaché (client ponctuel)", () => {
    const dossier = creerDossierSav(db, {
      siteId,
      descriptionPanne: "Ne s'allume plus",
      sousGarantie: false,
      userId,
    });

    expect(dossier.statut).toBe("RECU");
    expect(dossier.idAbonne).toBeNull();

    const historique = listerHistoriqueSav(db, dossier.idDossierSav);
    expect(historique).toHaveLength(1);
    expect(historique[0].statutAvant).toBeNull();
    expect(historique[0].statutApres).toBe("RECU");
  });

  it("rattache un abonné existant quand fourni", () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "N", prenom: "P", telephone: "690000000" }).returning().get();

    const dossier = creerDossierSav(db, {
      siteId,
      idAbonne: abonne.idAbonne,
      descriptionPanne: "Décodeur en panne",
      sousGarantie: true,
      userId,
    });

    expect(dossier.idAbonne).toBe(abonne.idAbonne);
    expect(dossier.sousGarantie).toBe(1);
  });
});

describe("listerDossiersSav / trouverDossierSav", () => {
  it("liste les dossiers du site et retrouve un dossier par id", () => {
    const dossier = creerDossierSav(db, { siteId, descriptionPanne: "Panne", sousGarantie: false, userId });

    expect(listerDossiersSav(db, siteId)).toHaveLength(1);
    expect(trouverDossierSav(db, dossier.idDossierSav)?.idDossierSav).toBe(dossier.idDossierSav);
  });
});
