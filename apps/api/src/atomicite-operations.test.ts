import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { creerDbTest, type Db } from "./test-utils/db.js";
import * as schema from "./db/schema.js";
import { creerAvoir } from "./modules/factures/avoir.service.js";
import { annulerPaiement } from "./modules/factures/annulation-paiement.service.js";
import { transfererStock } from "./modules/stock/transfert.service.js";
import { enregistrerMouvement } from "./modules/stock/stock.repository.js";
import { receptionnerAchat } from "./modules/stock/stock.service.js";
import { modifierProduit } from "./modules/produits/produit.repository.js";
import { actualiserStatutTransaction, initierPaiementMobile } from "./modules/paiement-mobile/paiement-mobile.service.js";

// Ces opérations écrivent en plusieurs étapes (facture d'avoir puis lignes puis stock ; produit de destination
// puis deux mouvements ; trace d'audit puis suppression puis statut de la facture). Un échec en cours de route
// laissait l'état à moitié modifié. Un déclencheur SQLite refuse l'écriture au point voulu pour le prouver.
let db: Db;
let siteId: number;
let autreSiteId: number;
let userId: number;

function refuserEcriture(table: string, evenement: "INSERT" | "UPDATE", colonne?: string) {
  const cible = colonne && evenement === "UPDATE" ? `UPDATE OF ${colonne}` : evenement;
  db.$client.exec(`CREATE TRIGGER refus_${table}_${evenement}_${colonne ?? "tout"} BEFORE ${cible} ON ${table} BEGIN SELECT RAISE(ABORT, 'échec simulé'); END;`);
}

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "GERANT" }).returning().get().idUser;
});

describe("creerAvoir : atomicité (6.4)", () => {
  it("n'écrit ni facture d'avoir ni ligne quand la restitution de stock échoue", () => {
    const produit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble", prixVente: 5000, suiviStock: 1 }).returning().get();
    const facture = db.insert(schema.facture).values({ siteId, statut: "VALIDEE", montantTotal: 5000, creePar: userId }).returning().get();
    const ligne = db.insert(schema.ligneVente).values({ idFacture: facture.idFacture, idProduit: produit.idProduit, quantite: 1, prixApplique: 5000 }).returning().get();
    refuserEcriture("stock_mouvement", "INSERT");

    expect(() => creerAvoir(db, { idFactureOrigine: facture.idFacture, lignes: [{ idLigneOrigine: ligne.idLigne, quantite: 1 }], restituerStock: true, userId })).toThrow(/échec simulé/);

    expect(db.select().from(schema.facture).where(eq(schema.facture.type, "AVOIR")).all()).toHaveLength(0);
    expect(db.select().from(schema.ligneVente).all()).toHaveLength(1); // la ligne d'origine seule
  });
});

describe("transfererStock : atomicité (5.2)", () => {
  it("ne crée pas le produit de destination ni de mouvement quand la sortie de stock échoue", () => {
    const source = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000, suiviStock: 1, quantiteStock: 5 }).returning().get();
    refuserEcriture("stock_mouvement", "INSERT");

    expect(() => transfererStock(db, { idProduitSource: source.idProduit, siteDestinationId: autreSiteId, quantite: 2, userId })).toThrow(/échec simulé/);

    expect(db.select().from(schema.produit).where(eq(schema.produit.siteId, autreSiteId)).all()).toHaveLength(0);
    expect(db.select().from(schema.stockMouvement).all()).toHaveLength(0);
    expect(db.select().from(schema.produit).where(eq(schema.produit.idProduit, source.idProduit)).get()?.quantiteStock).toBe(5);
  });
});

describe("annulerPaiement : atomicité (9.1, 11.5)", () => {
  it("conserve le paiement et n'écrit aucune trace quand la mise à jour de la facture échoue", () => {
    const facture = db.insert(schema.facture).values({ siteId, statut: "VALIDEE", montantTotal: 5000, creePar: userId }).returning().get();
    const paiement = db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: 5000, utilisateurId: userId }).returning().get();
    refuserEcriture("facture", "UPDATE");

    expect(() => annulerPaiement(db, { idPaiement: paiement.idPaiement, userId })).toThrow(/échec simulé/);

    expect(db.select().from(schema.paiement).where(eq(schema.paiement.idPaiement, paiement.idPaiement)).all()).toHaveLength(1);
    expect(db.select().from(schema.journalAudit).where(and(eq(schema.journalAudit.tableCible, "paiement"), eq(schema.journalAudit.action, "SUPPRESSION"))).all()).toHaveLength(0);
    expect(db.select().from(schema.facture).where(eq(schema.facture.idFacture, facture.idFacture)).get()?.statut).toBe("VALIDEE");
  });
});

// 5.2 : « le mouvement et le cache produit.quantite_stock s'écrivent en un même geste, pour que les deux ne
// puissent jamais diverger » — c'était vrai dans l'intention, pas dans l'exécution (deux instructions séparées).
describe("mouvements de stock : atomicité (5.2)", () => {
  const nouveauProduit = () => db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble", prixVente: 2000, coutRevient: 700, suiviStock: 1, quantiteStock: 10 }).returning().get();

  it("enregistrerMouvement n'écrit pas le mouvement quand la mise à jour du stock échoue", () => {
    const produit = nouveauProduit();
    refuserEcriture("produit", "UPDATE");

    expect(() => enregistrerMouvement(db, { idProduit: produit.idProduit, siteId, typeMouvement: "ACHAT", quantite: 3, utilisateurId: userId })).toThrow(/échec simulé/);

    expect(db.select().from(schema.stockMouvement).all()).toHaveLength(0);
    expect(db.select().from(schema.produit).where(eq(schema.produit.idProduit, produit.idProduit)).get()?.quantiteStock).toBe(10);
  });

  it("receptionnerAchat n'écrit ni mouvement ni stock quand le recalcul du coût moyen échoue", () => {
    const produit = nouveauProduit();
    refuserEcriture("produit", "UPDATE", "cout_revient");

    expect(() => receptionnerAchat(db, { idProduit: produit.idProduit, siteId, quantite: 5, coutUnitaire: 900, userId })).toThrow(/échec simulé/);

    expect(db.select().from(schema.stockMouvement).all()).toHaveLength(0);
    expect(db.select().from(schema.produit).where(eq(schema.produit.idProduit, produit.idProduit)).get()).toMatchObject({ quantiteStock: 10, coutRevient: 700 });
  });
});

describe("modifierProduit : atomicité de l'historique de prix (8.2)", () => {
  it("n'écrit pas de ligne d'historique pour un changement de prix qui n'a pas eu lieu", () => {
    const produit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble", prixVente: 2000, coutRevient: 700 }).returning().get();
    refuserEcriture("produit", "UPDATE");

    expect(() => modifierProduit(db, produit.idProduit, { prixVente: 2500, userId })).toThrow(/échec simulé/);

    expect(db.select().from(schema.historiquePrixProduit).all()).toHaveLength(0);
    expect(db.select().from(schema.produit).where(eq(schema.produit.idProduit, produit.idProduit)).get()?.prixVente).toBe(2000);
  });
});

describe("confirmation d'un paiement Mobile Money : atomicité (6.6)", () => {
  it("n'enregistre pas le paiement ni le changement de statut quand la validation de la facture échoue", async () => {
    const facture = db.insert(schema.facture).values({ siteId, montantTotal: 5000, creePar: userId }).returning().get();
    const fournisseur = { initier: async () => ({ referenceFournisseur: "REF-ATOM" }), consulterStatut: async () => "REUSSIE" as const };
    const transaction = await initierPaiementMobile(db, fournisseur, { idFacture: facture.idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" });
    refuserEcriture("facture", "UPDATE");

    await expect(actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId)).rejects.toThrow(/échec simulé/);

    expect(db.select().from(schema.paiement).all()).toHaveLength(0);
    expect(db.select().from(schema.transactionMobileMoney).where(eq(schema.transactionMobileMoney.idTransaction, transaction.idTransaction)).get()?.statut).toBe("EN_ATTENTE");
  });
});
