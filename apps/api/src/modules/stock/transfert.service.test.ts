import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { transfererStock } from "./transfert.service.js";

let db: Db;
let idEntreprise: number;
let siteSource: number;
let siteDestination: number;
let userId: number;
let idProduitSource: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  idEntreprise = ent.idEntreprise;
  siteSource = db.insert(schema.site).values({ idEntreprise, nom: "Site A" }).returning().get().idSite;
  siteDestination = db.insert(schema.site).values({ idEntreprise, nom: "Site B" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId: siteSource, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "GERANT" })
    .returning()
    .get().idUser;
  idProduitSource = db
    .insert(schema.produit)
    .values({ siteId: siteSource, type: "BIEN", libelle: "Décodeur GLOBALZ", categorie: "Décodeurs", prixVente: 15000, coutRevient: 9000, suiviStock: 1, quantiteStock: 10, seuilAlerte: 3 })
    .returning()
    .get().idProduit;
});

describe("transfererStock (5.2, 8.2)", () => {
  it("décrémente le site source et incrémente un produit déjà existant au site destination", () => {
    const idProduitDestination = db
      .insert(schema.produit)
      .values({ siteId: siteDestination, type: "BIEN", libelle: "Décodeur GLOBALZ", prixVente: 15000, suiviStock: 1, quantiteStock: 2 })
      .returning()
      .get().idProduit;

    const resultat = transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 4, userId });

    expect(resultat.produitSource.quantiteStock).toBe(6);
    expect(resultat.produitDestination.idProduit).toBe(idProduitDestination);
    expect(resultat.produitDestination.quantiteStock).toBe(6);
  });

  it("associe par libellé insensible à la casse et aux espaces, sans dupliquer l'article", () => {
    const idProduitDestination = db
      .insert(schema.produit)
      .values({ siteId: siteDestination, type: "BIEN", libelle: "  décodeur globalz  ", prixVente: 15000, suiviStock: 1, quantiteStock: 0 })
      .returning()
      .get().idProduit;

    const resultat = transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 1, userId });

    expect(resultat.produitDestination.idProduit).toBe(idProduitDestination);
    const produits = db.select().from(schema.produit).where(eq(schema.produit.siteId, siteDestination)).all();
    expect(produits).toHaveLength(1);
  });

  it("crée l'article au site destination s'il n'y existe pas encore, en reprenant la fiche article", () => {
    const resultat = transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 3, userId });

    expect(resultat.produitDestination.siteId).toBe(siteDestination);
    expect(resultat.produitDestination).toMatchObject({
      libelle: "Décodeur GLOBALZ",
      categorie: "Décodeurs",
      prixVente: 15000,
      coutRevient: 9000,
      suiviStock: 1,
      seuilAlerte: 3,
      quantiteStock: 3,
    });
  });

  it("journalise un mouvement double : TRANSFERT_SORTIE au site source, TRANSFERT_ENTREE au site destination", () => {
    const resultat = transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 4, motif: "Réassort boutique B", userId });

    const mouvementSortie = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idProduitSource)).all();
    expect(mouvementSortie).toHaveLength(1);
    expect(mouvementSortie[0]).toMatchObject({ typeMouvement: "TRANSFERT_SORTIE", quantite: 4, siteId: siteSource, motif: "Réassort boutique B" });

    const mouvementEntree = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, resultat.produitDestination.idProduit)).all();
    expect(mouvementEntree).toHaveLength(1);
    expect(mouvementEntree[0]).toMatchObject({ typeMouvement: "TRANSFERT_ENTREE", quantite: 4, siteId: siteDestination });
  });

  it("rejette un transfert vers le même site", () => {
    expect(() => transfererStock(db, { idProduitSource, siteDestinationId: siteSource, quantite: 1, userId })).toThrow(/site/i);
  });

  it("rejette une quantité nulle ou négative", () => {
    expect(() => transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 0, userId })).toThrow(/quantité/i);
  });

  it("rejette un produit source inconnu", () => {
    expect(() => transfererStock(db, { idProduitSource: 999999, siteDestinationId: siteDestination, quantite: 1, userId })).toThrow(/introuvable/i);
  });

  it("rejette un site destination inconnu", () => {
    expect(() => transfererStock(db, { idProduitSource, siteDestinationId: 999999, quantite: 1, userId })).toThrow(/introuvable/i);
  });
});
