import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { creerVenteProduits } from "./vente.service.js";

let db: Db;
let siteId: number;
let userId: number;
let idBien: number;
let idService: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  idBien = db
    .insert(schema.produit)
    .values({ siteId, type: "BIEN", libelle: "Télécommande universelle", prixVente: 2500, suiviStock: 1, quantiteStock: 10 })
    .returning()
    .get().idProduit;
  idService = db
    .insert(schema.produit)
    .values({ siteId, type: "SERVICE", libelle: "Installation à domicile", prixVente: 5000, suiviStock: 0 })
    .returning()
    .get().idProduit;
});

describe("creerVenteProduits (5.2, 5.3, 8.5)", () => {
  it("crée une facture avec une ligne par article et calcule le total", () => {
    const resultat = creerVenteProduits(db, {
      siteId,
      userId,
      lignes: [
        { idProduit: idBien, quantite: 2 },
        { idProduit: idService, quantite: 1 },
      ],
      montantEncaisse: 0,
    });

    expect(resultat.montantTotal).toBe(2500 * 2 + 5000);

    const lignes = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, resultat.idFacture)).all();
    expect(lignes).toHaveLength(2);
    const ligneBien = lignes.find((l) => l.idProduit === idBien);
    expect(ligneBien?.quantite).toBe(2);
    expect(ligneBien?.prixApplique).toBe(5000);
  });

  it("décrémente le stock des produits suivis, mais pas des services", () => {
    creerVenteProduits(db, {
      siteId,
      userId,
      lignes: [
        { idProduit: idBien, quantite: 3 },
        { idProduit: idService, quantite: 1 },
      ],
      montantEncaisse: 0,
    });

    const bien = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idBien)).get();
    expect(bien?.quantiteStock).toBe(7);

    const mouvements = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idService)).all();
    expect(mouvements).toHaveLength(0);
  });

  it("laisse la facture en BROUILLON sans encaissement, et la valide dès qu'un montant est encaissé", () => {
    const brouillon = creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idBien, quantite: 1 }], montantEncaisse: 0 });
    expect(brouillon.statutFacture).toBe("BROUILLON");

    const validee = creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idBien, quantite: 1 }], montantEncaisse: 2500 });
    expect(validee.statutFacture).toBe("VALIDEE");
    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, validee.idFacture)).all();
    expect(paiements).toHaveLength(1);
    expect(paiements[0].montant).toBe(2500);
  });

  // 11.5 : "toute action sensible doit être journalisée... encaissement"
  it("11.5 : journalise l'auteur de l'encaissement sur le paiement", () => {
    const resultat = creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idBien, quantite: 1 }], montantEncaisse: 2500 });

    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, resultat.idFacture)).all();
    expect(paiements[0].utilisateurId).toBe(userId);
  });

  // 6.5 : "Virement bancaire — Banque émettrice, référence de virement"
  it("vente payée par virement -> le paiement enregistre le mode et la référence de virement", () => {
    const resultat = creerVenteProduits(db, {
      siteId,
      userId,
      lignes: [{ idProduit: idBien, quantite: 1 }],
      montantEncaisse: 2500,
      modePaiement: "VIREMENT",
      banque: "CBC",
      referenceVirement: "VIR-2025-000900",
    });

    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, resultat.idFacture)).all();
    expect(paiements).toHaveLength(1);
    expect(paiements[0].mode).toBe("VIREMENT");
    expect(paiements[0].banque).toBe("CBC");
    expect(paiements[0].referenceVirement).toBe("VIR-2025-000900");
  });

  it("rattache la facture à un abonné quand idAbonne est fourni, sans abonné sinon", () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Alice", telephone: "690000001" }).returning().get();

    const avecAbonne = creerVenteProduits(db, {
      siteId,
      userId,
      idAbonne: abonne.idAbonne,
      lignes: [{ idProduit: idBien, quantite: 1 }],
      montantEncaisse: 0,
    });
    const factureAvecAbonne = db.select().from(schema.facture).where(eq(schema.facture.idFacture, avecAbonne.idFacture)).get();
    expect(factureAvecAbonne?.idAbonne).toBe(abonne.idAbonne);

    const sansAbonne = creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idBien, quantite: 1 }], montantEncaisse: 0 });
    const factureSansAbonne = db.select().from(schema.facture).where(eq(schema.facture.idFacture, sansAbonne.idFacture)).get();
    expect(factureSansAbonne?.idAbonne).toBeNull();
  });

  it("rejette une vente sans article", () => {
    expect(() => creerVenteProduits(db, { siteId, userId, lignes: [], montantEncaisse: 0 })).toThrow(/au moins un article/);
  });

  it("rejette une quantité nulle ou négative", () => {
    expect(() => creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idBien, quantite: 0 }], montantEncaisse: 0 })).toThrow(
      /quantité/
    );
  });

  it("rejette un produit inconnu", () => {
    expect(() => creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: 999999, quantite: 1 }], montantEncaisse: 0 })).toThrow(
      /introuvable/
    );
  });

  it("6.4 : applique une remise ponctuelle sur une ligne, conservée pour transparence", () => {
    const resultat = creerVenteProduits(db, {
      siteId,
      userId,
      lignes: [{ idProduit: idBien, quantite: 2, remise: 500 }],
      montantEncaisse: 0,
    });

    expect(resultat.montantTotal).toBe(2500 * 2 - 500);
    const ligne = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, resultat.idFacture)).all()[0];
    expect(ligne).toMatchObject({ prixApplique: 4500, remise: 500 });
  });

  it("6.4 : rejette une remise dépassant le prix catalogue de la ligne", () => {
    expect(() =>
      creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idBien, quantite: 1, remise: 3000 }], montantEncaisse: 0 })
    ).toThrow(/remise/i);
  });

  it("6.4 : rejette une remise négative", () => {
    expect(() =>
      creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idBien, quantite: 1, remise: -100 }], montantEncaisse: 0 })
    ).toThrow(/remise/i);
  });
});
