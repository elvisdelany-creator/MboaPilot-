import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerDossierSav, trouverDossierSav, listerHistoriqueSav } from "./sav.repository.js";
import { affecterPieceSav, changerStatutSav } from "./sav.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idProduitPiece: number;
let idDossierSav: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "TECHNICIEN_SAV" })
    .returning()
    .get().idUser;
  idProduitPiece = db
    .insert(schema.produit)
    .values({ siteId, type: "BIEN", libelle: "Alimentation", prixVente: 3000, quantiteStock: 10 })
    .returning()
    .get().idProduit;
  idDossierSav = creerDossierSav(db, { siteId, descriptionPanne: "Ne s'allume plus", sousGarantie: false, userId }).idDossierSav;
});

describe("affecterPieceSav (5.10)", () => {
  it("affecte une pièce au dossier et décrémente le stock", () => {
    affecterPieceSav(db, { idDossierSav, idProduit: idProduitPiece, quantite: 2, userId });

    const pieces = db.select().from(schema.savPieceUtilisee).where(eq(schema.savPieceUtilisee.idDossierSav, idDossierSav)).all();
    expect(pieces).toHaveLength(1);
    expect(pieces[0].quantite).toBe(2);

    const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduitPiece)).get();
    expect(produit?.quantiteStock).toBe(8);

    const mouvements = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idProduitPiece)).all();
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0].typeMouvement).toBe("VENTE");
    expect(mouvements[0].quantite).toBe(2);
  });
});

describe("changerStatutSav — cycle de vie (5.10)", () => {
  it("passe RECU -> DIAGNOSTIC et enregistre le diagnostic", () => {
    changerStatutSav(db, { idDossierSav, nouveauStatut: "DIAGNOSTIC", diagnostic: "Alimentation grillée", userId });

    const dossier = trouverDossierSav(db, idDossierSav);
    expect(dossier?.statut).toBe("DIAGNOSTIC");
    expect(dossier?.diagnostic).toBe("Alimentation grillée");

    const histo = listerHistoriqueSav(db, idDossierSav);
    expect(histo).toHaveLength(2); // ouverture + ce changement
    expect(histo[1].statutAvant).toBe("RECU");
    expect(histo[1].statutApres).toBe("DIAGNOSTIC");
    expect(histo[1].utilisateurId).toBe(userId);
  });

  it("rejette une transition invalide (RECU -> PRET)", () => {
    expect(() => changerStatutSav(db, { idDossierSav, nouveauStatut: "PRET", userId })).toThrow(/transition/i);
  });

  it("exige un motif pour IRREPARABLE", () => {
    expect(() => changerStatutSav(db, { idDossierSav, nouveauStatut: "IRREPARABLE", userId })).toThrow(/motif/i);
  });

  it("passage en PRET hors garantie : génère une facture BROUILLON avec pièces + main d'œuvre", () => {
    changerStatutSav(db, { idDossierSav, nouveauStatut: "DIAGNOSTIC", userId });
    affecterPieceSav(db, { idDossierSav, idProduit: idProduitPiece, quantite: 1, userId }); // 3000 FCFA

    const resultat = changerStatutSav(db, { idDossierSav, nouveauStatut: "REPARATION", userId });
    const resultatPret = changerStatutSav(db, { idDossierSav, nouveauStatut: "PRET", montantMainOeuvre: 2000, userId });

    expect(resultatPret.montantFacture).toBe(5000); // 3000 pièce + 2000 main d'œuvre
    expect(resultatPret.statutFacture).toBe("BROUILLON");

    const dossier = trouverDossierSav(db, idDossierSav);
    expect(dossier?.idFacture).toBe(resultatPret.idFacture);
    expect(dossier?.montantMainOeuvre).toBe(2000);
    void resultat;
  });

  it("passage en PRET sous garantie : facture à 0, auto-validée", () => {
    db.update(schema.savDossier).set({ sousGarantie: 1 }).where(eq(schema.savDossier.idDossierSav, idDossierSav)).run();
    changerStatutSav(db, { idDossierSav, nouveauStatut: "DIAGNOSTIC", userId });
    affecterPieceSav(db, { idDossierSav, idProduit: idProduitPiece, quantite: 1, userId });
    changerStatutSav(db, { idDossierSav, nouveauStatut: "REPARATION", userId });

    const resultat = changerStatutSav(db, { idDossierSav, nouveauStatut: "PRET", userId });

    expect(resultat.montantFacture).toBe(0);
    expect(resultat.statutFacture).toBe("VALIDEE");
  });

  it("PRET -> LIVRE avec encaissement valide la facture", () => {
    changerStatutSav(db, { idDossierSav, nouveauStatut: "DIAGNOSTIC", userId });
    changerStatutSav(db, { idDossierSav, nouveauStatut: "REPARATION", userId });
    changerStatutSav(db, { idDossierSav, nouveauStatut: "PRET", montantMainOeuvre: 4000, userId });

    const resultat = changerStatutSav(db, { idDossierSav, nouveauStatut: "LIVRE", montantEncaisse: 4000, userId });

    expect(resultat.statutFacture).toBe("VALIDEE");
    const dossier = trouverDossierSav(db, idDossierSav);
    expect(dossier?.statut).toBe("LIVRE");
  });

  it("rejette un dossier inconnu", () => {
    expect(() => changerStatutSav(db, { idDossierSav: 999999, nouveauStatut: "DIAGNOSTIC", userId })).toThrow(/introuvable/);
  });
});
