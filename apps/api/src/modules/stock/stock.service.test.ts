import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import {
  ajusterInventaire,
  decrementerComposantsKit,
  enregistrerCasse,
  listerAlertesStock,
  listerProduitsRotationLente,
  receptionnerAchat,
} from "./stock.service.js";
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

// 8.6, 9.3 : "État des stocks — Alertes de rupture, valorisation du stock,
// produits à rotation lente" — un produit suivi, avec du stock disponible,
// mais sans vente récente (30 jours) est signalé pour éviter l'immobilisation de capital
describe("listerProduitsRotationLente (8.6, 9.3)", () => {
  it("signale un produit sans aucune vente enregistrée", () => {
    const rotationLente = listerProduitsRotationLente(db, siteId, "2026-01-31");

    expect(rotationLente).toHaveLength(1);
    expect(rotationLente[0].produit.idProduit).toBe(idProduit);
    expect(rotationLente[0].derniereVente).toBeNull();
    expect(rotationLente[0].joursDepuisDerniereVente).toBeNull();
  });

  it("signale un produit dont la dernière vente remonte à plus de 30 jours", () => {
    db.insert(schema.stockMouvement)
      .values({ idProduit, siteId, typeMouvement: "VENTE", quantite: 1, utilisateurId: userId, dateMouvement: "2025-12-01 10:00:00" })
      .run();

    const rotationLente = listerProduitsRotationLente(db, siteId, "2026-01-31"); // 61 jours plus tard

    expect(rotationLente).toHaveLength(1);
    expect(rotationLente[0].derniereVente).toBe("2025-12-01 10:00:00");
    expect(rotationLente[0].joursDepuisDerniereVente).toBe(61);
  });

  it("n'alerte pas un produit vendu récemment (moins de 30 jours)", () => {
    db.insert(schema.stockMouvement)
      .values({ idProduit, siteId, typeMouvement: "VENTE", quantite: 1, utilisateurId: userId, dateMouvement: "2026-01-15 10:00:00" })
      .run();

    expect(listerProduitsRotationLente(db, siteId, "2026-01-31")).toHaveLength(0); // 16 jours
  });

  it("ignore un produit sans suivi de stock ou sans stock disponible", () => {
    db.insert(schema.produit).values({ siteId, type: "SERVICE", libelle: "Installation", prixVente: 5000, suiviStock: 0 }).run();
    db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble", prixVente: 500, suiviStock: 1, quantiteStock: 0 }).run();

    const rotationLente = listerProduitsRotationLente(db, siteId, "2026-01-31");
    expect(rotationLente.map((r) => r.produit.libelle)).toEqual(["Décodeur"]);
  });

  it("trie du produit le plus longtemps invendu au plus récent", () => {
    const autreProduit = db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 1500, suiviStock: 1, quantiteStock: 5 })
      .returning()
      .get().idProduit;
    db.insert(schema.stockMouvement)
      .values({ idProduit: autreProduit, siteId, typeMouvement: "VENTE", quantite: 1, utilisateurId: userId, dateMouvement: "2025-12-20 10:00:00" })
      .run();
    // idProduit (Décodeur) n'a jamais été vendu — doit passer en premier (le plus critique)

    const rotationLente = listerProduitsRotationLente(db, siteId, "2026-01-31");

    expect(rotationLente.map((r) => r.produit.libelle)).toEqual(["Décodeur", "Câble HDMI"]);
  });
});

describe("decrementerComposantsKit (5.1, 5.2 : kit \"produit composé\")", () => {
  let idKit: number;
  let idParabole: number;
  let idAccessoireSansSuivi: number;

  beforeEach(() => {
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    idKit = db
      .insert(schema.kit)
      .values({ idFamille: famille.idFamille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_FIXE", prixFixe: 15000 })
      .returning()
      .get().idKit;
    idParabole = db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Parabole", prixVente: 3000, suiviStock: 1, quantiteStock: 20 })
      .returning()
      .get().idProduit;
    idAccessoireSansSuivi = db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Câbles et fixations", prixVente: 500, suiviStock: 0 })
      .returning()
      .get().idProduit;

    db.insert(schema.kitComposant).values({ idKit, idProduit, quantite: 1 }).run(); // le décodeur du beforeEach parent
    db.insert(schema.kitComposant).values({ idKit, idProduit: idParabole, quantite: 1 }).run();
    db.insert(schema.kitComposant).values({ idKit, idProduit: idAccessoireSansSuivi, quantite: 2 }).run();
  });

  it("décrémente chaque composant suivi, ignore les composants sans suivi de stock", () => {
    decrementerComposantsKit(db, { idKit, siteId, userId });

    const decodeur = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduit)).get();
    expect(decodeur?.quantiteStock).toBe(9); // 10 - 1

    const parabole = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idParabole)).get();
    expect(parabole?.quantiteStock).toBe(19); // 20 - 1

    const mouvementsAccessoire = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idAccessoireSansSuivi)).all();
    expect(mouvementsAccessoire).toHaveLength(0);
  });

  it("journalise un mouvement VENTE par composant décrémenté", () => {
    decrementerComposantsKit(db, { idKit, siteId, userId });

    const mouvements = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idProduit)).all();
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0]).toMatchObject({ typeMouvement: "VENTE", quantite: 1 });
  });

  it("ne fait rien pour un kit sans composant déclaré", () => {
    const idKitSansComposant = db
      .insert(schema.kit)
      .values({ idFamille: db.select().from(schema.familleAbonnement).get()!.idFamille, libelle: "KIT SANS COMPOSANT", reglePrix: "PRIX_FIXE", prixFixe: 1000 })
      .returning()
      .get().idKit;

    expect(() => decrementerComposantsKit(db, { idKit: idKitSansComposant, siteId, userId })).not.toThrow();
    const decodeur = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduit)).get();
    expect(decodeur?.quantiteStock).toBe(10); // inchangé
  });
});
