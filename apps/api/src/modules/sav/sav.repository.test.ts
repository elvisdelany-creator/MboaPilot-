import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerDossierSav, listerDossiersSav, listerHistoriqueSav, listerPiecesUtilisees, trouverDossierSav } from "./sav.repository.js";
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

  // 5.10, 8.4 : identité du client ponctuel — pour la restitution et la notification
  it("enregistre le nom et le téléphone d'un client ponctuel", () => {
    const dossier = creerDossierSav(db, {
      siteId,
      descriptionPanne: "Écran cassé",
      sousGarantie: false,
      userId,
      clientNom: "Mendo Luc",
      clientTelephone: "677889900",
    });

    expect(dossier.idAbonne).toBeNull();
    expect(dossier.clientNom).toBe("Mendo Luc");
    expect(dossier.clientTelephone).toBe("677889900");
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

// 5.10 : "Pièces affectées" doit afficher le libellé de l'article, pas son id brut
describe("listerPiecesUtilisees", () => {
  it("retourne le libellé du produit affecté à chaque pièce", () => {
    const dossier = creerDossierSav(db, { siteId, descriptionPanne: "Panne", sousGarantie: false, userId });
    const produit = db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Télécommande universelle", prixVente: 2500 })
      .returning()
      .get();
    db.insert(schema.savPieceUtilisee).values({ idDossierSav: dossier.idDossierSav, idProduit: produit.idProduit, quantite: 2 }).run();

    const pieces = listerPiecesUtilisees(db, dossier.idDossierSav);

    expect(pieces).toHaveLength(1);
    expect(pieces[0].idProduit).toBe(produit.idProduit);
    expect(pieces[0].quantite).toBe(2);
    expect(pieces[0].libelleProduit).toBe("Télécommande universelle");
  });
});
