import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerProduit, listerHistoriquePrixProduit, listerProduits, modifierProduit } from "./produit.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let autreSiteId: number;
let userId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" })
    .returning()
    .get().idUser;
});

describe("listerProduits (5.2, 7.3 : catalogue matériel/pièces détachées)", () => {
  it("renvoie les produits du site, cloisonnés", () => {
    db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Décodeur GLOBALZ", prixVente: 15000 }).run();
    db.insert(schema.produit).values({ siteId: autreSiteId, type: "BIEN", libelle: "Autre", prixVente: 5000 }).run();

    const produits = listerProduits(db, siteId);

    expect(produits).toHaveLength(1);
    expect(produits[0].libelle).toBe("Décodeur GLOBALZ");
  });
});

describe("creerProduit (8.2 : création d'une fiche article)", () => {
  it("crée un article et calcule la marge complémentaire (mode VALEUR)", () => {
    const produit = creerProduit(db, {
      siteId,
      type: "BIEN",
      libelle: "Câble HDMI",
      categorie: "Accessoires",
      prixVente: 2500,
      coutRevient: 1000,
      margeType: "VALEUR",
      margeValeur: 1500,
      suiviStock: true,
      seuilAlerte: 10,
    });

    expect(produit.categorie).toBe("Accessoires");
    expect(produit.margeValeur).toBe(1500);
    expect(produit.margePourcentage).toBe(15000); // 150.00 % du coût de revient
    expect(produit.suiviStock).toBe(1);
    expect(produit.quantiteStock).toBe(0); // le stock ne se remplit que par réception d'achat (5.2)
  });

  // 5.2 : "code interne/code-barres optionnel"
  it("enregistre le code interne/code-barres optionnel", () => {
    const produit = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, codeBarres: "3700123456789" });

    expect(produit.codeBarres).toBe("3700123456789");
  });

  it("le code-barres reste nul quand il n'est pas renseigné", () => {
    const produit = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500 });

    expect(produit.codeBarres).toBeNull();
  });

  it("mode POURCENTAGE : calcule le montant de marge équivalent", () => {
    const produit = creerProduit(db, {
      siteId,
      type: "SERVICE",
      libelle: "Installation",
      prixVente: 5000,
      coutRevient: 0,
      margeType: "POURCENTAGE",
      margePourcentage: 10000, // 100 %
    });

    expect(produit.margeValeur).toBe(0); // coût de revient nul -> aucune base de calcul
  });
});

describe("modifierProduit (8.2 : édition d'une fiche article, historique des prix)", () => {
  it("recalcule la marge complémentaire quand le coût de revient change", () => {
    const cree = creerProduit(db, { siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000, coutRevient: 8000, margeType: "VALEUR", margeValeur: 2000 });

    const modifie = modifierProduit(db, cree.idProduit, { coutRevient: 10000, userId });

    expect(modifie.margeValeur).toBe(2000); // le montant en mode VALEUR ne bouge pas
    expect(modifie.margePourcentage).toBe(2000); // 2000/10000 = 20.00 %, recalculé
  });

  it("journalise un changement de prix ou de coût dans l'historique", () => {
    const cree = creerProduit(db, { siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000, coutRevient: 8000 });

    modifierProduit(db, cree.idProduit, { prixVente: 16000, userId });

    const histo = listerHistoriquePrixProduit(db, cree.idProduit);
    expect(histo).toHaveLength(1);
    expect(histo[0].prixVenteAvant).toBe(15000);
    expect(histo[0].prixVenteApres).toBe(16000);
    expect(histo[0].utilisateurId).toBe(userId);
  });

  it("ne journalise rien si ni le prix ni le coût n'ont changé", () => {
    const cree = creerProduit(db, { siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000, coutRevient: 8000 });

    modifierProduit(db, cree.idProduit, { libelle: "Décodeur GLOBALZ", userId });

    expect(listerHistoriquePrixProduit(db, cree.idProduit)).toHaveLength(0);
  });

  it("rejette un produit inconnu", () => {
    expect(() => modifierProduit(db, 999999, { prixVente: 1000, userId })).toThrow(/introuvable/);
  });

  it("modifie le code interne/code-barres d'un article existant", () => {
    const cree = creerProduit(db, { siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000 });

    const modifie = modifierProduit(db, cree.idProduit, { codeBarres: "3700987654321", userId });

    expect(modifie.codeBarres).toBe("3700987654321");
  });
});
