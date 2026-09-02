import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { enregistrerMouvement, listerMouvementsProduit } from "./stock.repository.js";
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
    .values({ siteId, type: "BIEN", libelle: "Décodeur", prixVente: 10000, suiviStock: 1, quantiteStock: 10 })
    .returning()
    .get().idProduit;
});

describe("enregistrerMouvement (5.2)", () => {
  it("ACHAT incrémente le stock", () => {
    const produit = enregistrerMouvement(db, { idProduit, siteId, typeMouvement: "ACHAT", quantite: 5, utilisateurId: userId });
    expect(produit.quantiteStock).toBe(15);
  });

  it("VENTE et CASSE décrémentent le stock", () => {
    enregistrerMouvement(db, { idProduit, siteId, typeMouvement: "VENTE", quantite: 3, utilisateurId: userId });
    const produit = enregistrerMouvement(db, { idProduit, siteId, typeMouvement: "CASSE", quantite: 2, motif: "Chute", utilisateurId: userId });
    expect(produit.quantiteStock).toBe(5);
  });

  it("INVENTAIRE applique directement l'écart signé fourni", () => {
    const produit = enregistrerMouvement(db, { idProduit, siteId, typeMouvement: "INVENTAIRE", quantite: -4, motif: "Comptage", utilisateurId: userId });
    expect(produit.quantiteStock).toBe(6);
  });

  it("journalise chaque mouvement avec son motif", () => {
    enregistrerMouvement(db, { idProduit, siteId, typeMouvement: "CASSE", quantite: 1, motif: "Vol", utilisateurId: userId });

    const mouvements = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idProduit)).all();
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0].typeMouvement).toBe("CASSE");
    expect(mouvements[0].motif).toBe("Vol");
  });

  it("rejette un produit inconnu", () => {
    expect(() => enregistrerMouvement(db, { idProduit: 999999, siteId, typeMouvement: "ACHAT", quantite: 1, utilisateurId: userId })).toThrow(/introuvable/);
  });
});

describe("listerMouvementsProduit", () => {
  it("renvoie les mouvements du plus récent au plus ancien", () => {
    enregistrerMouvement(db, { idProduit, siteId, typeMouvement: "ACHAT", quantite: 1, utilisateurId: userId });
    enregistrerMouvement(db, { idProduit, siteId, typeMouvement: "VENTE", quantite: 1, utilisateurId: userId });

    const mouvements = listerMouvementsProduit(db, idProduit);
    expect(mouvements).toHaveLength(2);
    expect(mouvements[0].typeMouvement).toBe("VENTE");
    expect(mouvements[1].typeMouvement).toBe("ACHAT");
  });
});
