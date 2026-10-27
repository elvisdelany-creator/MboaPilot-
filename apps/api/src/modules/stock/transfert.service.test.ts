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

// 5.2 : le coût de revient se recalcule en coût moyen pondéré à chaque entrée de stock — un transfert est une entrée au site
// destination, qui reçoit des unités au coût du site source. Laissé tel quel, le coût du destinataire ne bougeait pas : la valorisation
// du stock et la marge de ce site étaient fausses dès que les deux sites ne payaient pas l'article au même prix.
describe("transfererStock : coût moyen pondéré au site destination (5.2)", () => {
  const produitDestination = (quantiteStock: number, coutRevient: number) =>
    db
      .insert(schema.produit)
      .values({ siteId: siteDestination, type: "BIEN", libelle: "Décodeur GLOBALZ", prixVente: 15000, coutRevient, suiviStock: 1, quantiteStock })
      .returning()
      .get().idProduit;
  const cout = (idProduit: number) => db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduit)).get()!.coutRevient;

  it("pondère le coût des unités reçues avec celui du stock déjà présent au site destination", () => {
    const idDestination = produitDestination(6, 12000); // source : 9 000 le décodeur

    const resultat = transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 4, userId });

    expect(resultat.produitDestination.quantiteStock).toBe(10);
    expect(cout(idDestination)).toBe(Math.round((6 * 12000 + 4 * 9000) / 10)); // 10 800
    expect(resultat.produitDestination.coutRevient).toBe(10800);
  });

  it("reprend le coût de la source quand le site destination n'a aucune unité en stock", () => {
    const idDestination = produitDestination(0, 12000);

    transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 4, userId });

    expect(cout(idDestination)).toBe(9000);
  });

  it("n'altère pas le coût du site source, qui perd seulement des unités", () => {
    produitDestination(6, 12000);

    const resultat = transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 4, userId });

    expect(resultat.produitSource.coutRevient).toBe(9000);
  });

  it("garde le coût de la source sur un article créé au site destination", () => {
    const resultat = transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 4, userId });

    expect(resultat.produitDestination.coutRevient).toBe(9000);
    expect(resultat.produitDestination.quantiteStock).toBe(4);
  });

  it("n'écrit rien quand le transfert est refusé faute de stock source", () => {
    const idDestination = produitDestination(6, 12000);

    expect(() => transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 11, userId })).toThrow(/Stock insuffisant/);

    expect(cout(idDestination)).toBe(12000);
  });
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

  // 5.2, 8.2 : même repère qu'à l'import CSV (catalogue-import-export.service.ts)
  // — un article retapé sans accent au site destination ne doit pas créer un
  // doublon au lieu d'être reconnu comme le même article
  it("associe par libellé insensible aux accents, sans dupliquer l'article", () => {
    const idProduitDestination = db
      .insert(schema.produit)
      .values({ siteId: siteDestination, type: "BIEN", libelle: "Decodeur GLOBALZ", prixVente: 15000, suiviStock: 1, quantiteStock: 0 })
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

  // 5.2 : le code-barres identifie l'objet physique déplacé — un article
  // transféré doit rester scannable au site destination (recherche caisse
  // "libellé ou code-barres"), pas seulement retrouvable par son libellé
  it("reprend le code-barres de l'article source lors de la création au site destination", () => {
    db.update(schema.produit).set({ codeBarres: "1234567890128" }).where(eq(schema.produit.idProduit, idProduitSource)).run();

    const resultat = transfererStock(db, { idProduitSource, siteDestinationId: siteDestination, quantite: 3, userId });

    expect(resultat.produitDestination.codeBarres).toBe("1234567890128");
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
