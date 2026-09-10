import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { actualiserStatutTransaction, initierPaiementMobile } from "./paiement-mobile.service.js";
import type { FournisseurPaiementMobile, StatutFournisseur } from "./fournisseur.js";
import * as schema from "../../db/schema.js";

// fournisseur entièrement pilotable, indépendant du minuteur réel du simulateur
class FournisseurFactice implements FournisseurPaiementMobile {
  statut: StatutFournisseur = "EN_ATTENTE";
  reference = "REF-TEST-1";

  async initier() {
    return { referenceFournisseur: this.reference };
  }

  async consulterStatut() {
    return this.statut;
  }
}

let db: Db;
let siteId: number;
let userId: number;
let idFacture: number;
let fournisseur: FournisseurFactice;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  idFacture = db
    .insert(schema.facture)
    .values({ siteId, montantTotal: 5000, creePar: userId })
    .returning()
    .get().idFacture;
  fournisseur = new FournisseurFactice();
});

describe("initierPaiementMobile (6.6)", () => {
  it("crée une transaction EN_ATTENTE avec la référence du fournisseur", async () => {
    const transaction = await initierPaiementMobile(db, fournisseur, {
      idFacture,
      numeroTelephone: "690000000",
      montant: 5000,
      parcours: "USSD_CLIENT",
    });

    expect(transaction.statut).toBe("EN_ATTENTE");
    expect(transaction.referenceTransaction).toBe("REF-TEST-1");
  });

  it("rejette une facture déjà validée", async () => {
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, idFacture)).run();

    await expect(
      initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" })
    ).rejects.toThrow(/déjà validée/);
  });

  it("rejette une facture inconnue", async () => {
    await expect(
      initierPaiementMobile(db, fournisseur, { idFacture: 999999, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" })
    ).rejects.toThrow(/introuvable/);
  });
});

describe("actualiserStatutTransaction (6.6)", () => {
  it("REUSSIE : crée le paiement et valide la facture", async () => {
    const transaction = await initierPaiementMobile(db, fournisseur, {
      idFacture,
      numeroTelephone: "690000000",
      montant: 5000,
      parcours: "USSD_CLIENT",
    });

    fournisseur.statut = "REUSSIE";
    const resultat = await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);

    expect(resultat.statut).toBe("REUSSIE");
    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
    expect(facture?.statut).toBe("VALIDEE");
    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, idFacture)).all();
    expect(paiements).toHaveLength(1);
    expect(paiements[0].mode).toBe("MOBILE_MONEY");
    expect(paiements[0].montant).toBe(5000);
    expect(paiements[0].referenceTransaction).toBe("REF-TEST-1");
    expect(paiements[0].utilisateurId).toBe(userId); // 11.5 : caissier ayant consulté la confirmation
  });

  it("est idempotent : appelée deux fois après REUSSIE, ne crée qu'un seul paiement", async () => {
    const transaction = await initierPaiementMobile(db, fournisseur, {
      idFacture,
      numeroTelephone: "690000000",
      montant: 5000,
      parcours: "USSD_CLIENT",
    });

    fournisseur.statut = "REUSSIE";
    await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);
    await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);

    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, idFacture)).all();
    expect(paiements).toHaveLength(1);
  });

  it("ECHOUEE : ne crée aucun paiement, la facture reste BROUILLON", async () => {
    const transaction = await initierPaiementMobile(db, fournisseur, {
      idFacture,
      numeroTelephone: "690000000",
      montant: 5000,
      parcours: "USSD_CLIENT",
    });

    fournisseur.statut = "ECHOUEE";
    const resultat = await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);

    expect(resultat.statut).toBe("ECHOUEE");
    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
    expect(facture?.statut).toBe("BROUILLON");
    expect(db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, idFacture)).all()).toHaveLength(0);
  });

  it("rejette une transaction inconnue", async () => {
    await expect(actualiserStatutTransaction(db, fournisseur, 999999, userId)).rejects.toThrow(/introuvable/);
  });
});
