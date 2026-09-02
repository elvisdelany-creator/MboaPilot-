import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { ajusterInventaire, enregistrerCasse, listerAlertesStock, receptionnerAchat } from "./stock.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idProduit: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" })
    .returning()
    .get().idUser;
  idProduit = db
    .insert(schema.produit)
    .values({ siteId, type: "BIEN", libelle: "Décodeur", prixVente: 10000, coutRevient: 1000, suiviStock: 1, quantiteStock: 10, seuilAlerte: 5 })
    .returning()
    .get().idProduit;
});

describe("receptionnerAchat (5.2)", () => {
  it("incrémente le stock et recalcule le coût de revient en moyenne pondérée", () => {
    const produit = receptionnerAchat(db, { idProduit, siteId, quantite: 10, coutUnitaire: 2000, userId });

    expect(produit.quantiteStock).toBe(20);
    expect(produit.coutRevient).toBe(1500); // (10*1000 + 10*2000) / 20

    const mouvements = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idProduit)).all();
    expect(mouvements[0].typeMouvement).toBe("ACHAT");
  });

  it("rejette une quantité non positive", () => {
    expect(() => receptionnerAchat(db, { idProduit, siteId, quantite: 0, coutUnitaire: 2000, userId })).toThrow(/positive/i);
  });
});

describe("enregistrerCasse (5.2)", () => {
  it("décrémente le stock avec le motif fourni", () => {
    const produit = enregistrerCasse(db, { idProduit, siteId, quantite: 3, motif: "Chute pendant transport", userId });
    expect(produit.quantiteStock).toBe(7);
  });

  it("exige un motif", () => {
    expect(() => enregistrerCasse(db, { idProduit, siteId, quantite: 1, motif: "", userId })).toThrow(/motif/i);
  });
});

describe("ajusterInventaire (5.2)", () => {
  it("applique l'écart entre le comptage physique et le stock théorique", () => {
    const produit = ajusterInventaire(db, { idProduit, siteId, quantiteComptee: 7, motif: "Comptage mensuel", userId });
    expect(produit.quantiteStock).toBe(7);

    const mouvements = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idProduit)).all();
    expect(mouvements[0].typeMouvement).toBe("INVENTAIRE");
    expect(mouvements[0].quantite).toBe(-3);
  });

  it("exige un motif", () => {
    expect(() => ajusterInventaire(db, { idProduit, siteId, quantiteComptee: 7, motif: "", userId })).toThrow(/motif/i);
  });
});

describe("listerAlertesStock (8.6, 9.3)", () => {
  it("renvoie les produits suivis dont le stock est à ou sous le seuil d'alerte", () => {
    enregistrerCasse(db, { idProduit, siteId, quantite: 6, motif: "Perte", userId }); // 10 -> 4, seuil 5

    const alertes = listerAlertesStock(db, siteId);
    expect(alertes).toHaveLength(1);
    expect(alertes[0].idProduit).toBe(idProduit);
  });

  it("n'alerte pas un produit encore au-dessus du seuil", () => {
    expect(listerAlertesStock(db, siteId)).toHaveLength(0);
  });

  it("ignore les produits sans suivi de stock ou sans seuil défini", () => {
    db.insert(schema.produit).values({ siteId, type: "SERVICE", libelle: "Installation", prixVente: 5000, suiviStock: 0 }).run();
    db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble", prixVente: 500, suiviStock: 1, quantiteStock: 0 }).run(); // pas de seuil

    expect(listerAlertesStock(db, siteId)).toHaveLength(0);
  });
});
