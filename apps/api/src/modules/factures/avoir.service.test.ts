import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { creerAvoir } from "./avoir.service.js";

let db: Db;
let siteId: number;
let userId: number;
let idAbonne: number;
let idProduitSuivi: number;
let idProduitSansStock: number;
let idFactureValidee: number;
let idLigneProduitSuivi: number;
let idLigneSansStock: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" })
    .returning()
    .get().idUser;
  idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Alice", telephone: "690000000" }).returning().get().idAbonne;

  idProduitSuivi = db
    .insert(schema.produit)
    .values({ siteId, type: "BIEN", libelle: "Télécommande", prixVente: 2500, suiviStock: 1, quantiteStock: 5 })
    .returning()
    .get().idProduit;
  idProduitSansStock = db
    .insert(schema.produit)
    .values({ siteId, type: "SERVICE", libelle: "Installation", prixVente: 5000, suiviStock: 0 })
    .returning()
    .get().idProduit;

  const facture = db
    .insert(schema.facture)
    .values({ siteId, idAbonne, statut: "VALIDEE", montantTotal: 3 * 2500 + 5000, creePar: userId })
    .returning()
    .get();
  idFactureValidee = facture.idFacture;

  idLigneProduitSuivi = db
    .insert(schema.ligneVente)
    .values({ idFacture: idFactureValidee, idProduit: idProduitSuivi, quantite: 3, prixApplique: 3 * 2500 })
    .returning()
    .get().idLigne;
  idLigneSansStock = db
    .insert(schema.ligneVente)
    .values({ idFacture: idFactureValidee, idProduit: idProduitSansStock, quantite: 1, prixApplique: 5000 })
    .returning()
    .get().idLigne;
});

describe("creerAvoir (6.4)", () => {
  it("crée une facture AVOIR au montant négatif, rattachée à la facture d'origine", () => {
    const resultat = creerAvoir(db, {
      idFactureOrigine: idFactureValidee,
      lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 3 }],
      restituerStock: false,
      userId,
    });

    expect(resultat.montantTotal).toBe(-7500);
    const factureAvoir = db.select().from(schema.facture).where(eq(schema.facture.idFacture, resultat.idFactureAvoir)).get();
    expect(factureAvoir).toMatchObject({ type: "AVOIR", factureOrigineId: idFactureValidee, statut: "VALIDEE", montantTotal: -7500 });

    const lignes = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, resultat.idFactureAvoir)).all();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ ligneOrigineId: idLigneProduitSuivi, quantite: 3, prixApplique: -7500 });
  });

  it("accepte un avoir partiel (quantité inférieure à celle facturée)", () => {
    const resultat = creerAvoir(db, {
      idFactureOrigine: idFactureValidee,
      lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }],
      restituerStock: false,
      userId,
    });

    expect(resultat.montantTotal).toBe(-2500);
  });

  it("empêche de créditer plus que ce qui reste facturé, cumulé sur plusieurs avoirs", () => {
    creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 2 }], restituerStock: false, userId });

    expect(() =>
      creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 2 }], restituerStock: false, userId })
    ).toThrow(/disponible|quantité/i);

    // le reliquat exact (1) reste créditable
    const resultat = creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }], restituerStock: false, userId });
    expect(resultat.montantTotal).toBe(-2500);
  });

  it("restitue le stock uniquement si demandé, et uniquement pour un produit suivi", () => {
    creerAvoir(db, {
      idFactureOrigine: idFactureValidee,
      lignes: [
        { idLigneOrigine: idLigneProduitSuivi, quantite: 2 },
        { idLigneOrigine: idLigneSansStock, quantite: 1 },
      ],
      restituerStock: true,
      userId,
    });

    const produitSuivi = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduitSuivi)).get();
    expect(produitSuivi?.quantiteStock).toBe(7); // 5 + 2 restitués

    const mouvements = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idProduitSuivi)).all();
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0].typeMouvement).toBe("RETOUR_CLIENT");
    expect(mouvements[0].quantite).toBe(2);
  });

  it("ne restitue rien au stock quand restituerStock est faux", () => {
    creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 2 }], restituerStock: false, userId });

    const produitSuivi = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduitSuivi)).get();
    expect(produitSuivi?.quantiteStock).toBe(5);
  });

  it("rejette un avoir sur une facture BROUILLON", () => {
    const brouillon = db.insert(schema.facture).values({ siteId, idAbonne, statut: "BROUILLON", montantTotal: 1000, creePar: userId }).returning().get();
    const ligne = db.insert(schema.ligneVente).values({ idFacture: brouillon.idFacture, idProduit: idProduitSuivi, quantite: 1, prixApplique: 1000 }).returning().get();

    expect(() => creerAvoir(db, { idFactureOrigine: brouillon.idFacture, lignes: [{ idLigneOrigine: ligne.idLigne, quantite: 1 }], restituerStock: false, userId })).toThrow(
      /VALIDEE/
    );
  });

  it("rejette un avoir émis sur un avoir", () => {
    const premier = creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }], restituerStock: false, userId });
    const ligneAvoir = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, premier.idFactureAvoir)).all()[0];

    expect(() =>
      creerAvoir(db, { idFactureOrigine: premier.idFactureAvoir, lignes: [{ idLigneOrigine: ligneAvoir.idLigne, quantite: 1 }], restituerStock: false, userId })
    ).toThrow(/avoir/i);
  });

  it("rejette une ligne n'appartenant pas à la facture d'origine indiquée", () => {
    const autreFacture = db.insert(schema.facture).values({ siteId, idAbonne, statut: "VALIDEE", montantTotal: 1000, creePar: userId }).returning().get();

    expect(() =>
      creerAvoir(db, { idFactureOrigine: autreFacture.idFacture, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }], restituerStock: false, userId })
    ).toThrow(/introuvable/i);
  });

  it("rejette une facture inconnue", () => {
    expect(() => creerAvoir(db, { idFactureOrigine: 999999, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }], restituerStock: false, userId })).toThrow(
      /introuvable/i
    );
  });

  it("rejette un avoir sans ligne", () => {
    expect(() => creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [], restituerStock: false, userId })).toThrow(/ligne/i);
  });

  it("rejette une quantité à créditer nulle ou négative", () => {
    expect(() =>
      creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 0 }], restituerStock: false, userId })
    ).toThrow(/quantité/i);
  });
});
