import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { creerDbTest, type Db } from "./test-utils/db.js";
import * as schema from "./db/schema.js";
import { creerAvoir } from "./modules/factures/avoir.service.js";
import { annulerPaiement } from "./modules/factures/annulation-paiement.service.js";
import { transfererStock } from "./modules/stock/transfert.service.js";

// Ces opérations écrivent en plusieurs étapes (facture d'avoir puis lignes puis stock ; produit de destination
// puis deux mouvements ; trace d'audit puis suppression puis statut de la facture). Un échec en cours de route
// laissait l'état à moitié modifié. Un déclencheur SQLite refuse l'écriture au point voulu pour le prouver.
let db: Db;
let siteId: number;
let autreSiteId: number;
let userId: number;

function refuserEcriture(table: string, evenement: "INSERT" | "UPDATE") {
  db.$client.exec(`CREATE TRIGGER refus_${table}_${evenement} BEFORE ${evenement} ON ${table} BEGIN SELECT RAISE(ABORT, 'échec simulé'); END;`);
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
