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
  appelsConsulterStatut = 0;

  async initier() {
    return { referenceFournisseur: this.reference };
  }

  async consulterStatut() {
    this.appelsConsulterStatut++;
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

  it("rejette un montant nul ou négatif", async () => {
    await expect(
      initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: -5000, parcours: "USSD_CLIENT" })
    ).rejects.toThrow(/positif/i);
    await expect(
      initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 0, parcours: "USSD_CLIENT" })
    ).rejects.toThrow(/positif/i);
  });

  it("rejette une facture inconnue", async () => {
    await expect(
      initierPaiementMobile(db, fournisseur, { idFacture: 999999, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" })
    ).rejects.toThrow(/introuvable/);
  });

  // 6.6 : constaté en test grandeur nature — deux transactions initiées sur la
  // même facture tant que la première était en attente aboutissaient toutes
  // deux : une facture de 5 000 FCFA recevait 10 000 FCFA de paiements
  // Mobile Money (le client peut être débité deux fois).
  it("refuse d'initier un second paiement tant qu'un autre est en attente de confirmation sur la même facture", async () => {
    await initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" });

    await expect(
      initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" })
    ).rejects.toThrow(/déjà en attente/);
    expect(db.select().from(schema.transactionMobileMoney).where(eq(schema.transactionMobileMoney.idFacture, idFacture)).all()).toHaveLength(1);
  });

  it("autorise une nouvelle tentative une fois la précédente expirée, même si son statut n'a pas encore été actualisé", async () => {
    const premiere = await initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" });
    db.update(schema.transactionMobileMoney)
      .set({ dateExpiration: new Date(Date.now() - 1000).toISOString() })
      .where(eq(schema.transactionMobileMoney.idTransaction, premiere.idTransaction))
      .run();

    const seconde = await initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" });

    expect(seconde.statut).toBe("EN_ATTENTE");
  });

  it("autorise une nouvelle tentative après un échec de la précédente", async () => {
    const premiere = await initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" });
    fournisseur.statut = "ECHOUEE";
    await actualiserStatutTransaction(db, fournisseur, premiere.idTransaction, userId);

    const seconde = await initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" });

    expect(seconde.statut).toBe("EN_ATTENTE");
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

  // 6.6 : "EXPIRÉE : Délai de validation dépassé (OTP non saisi à temps) : la
  // transaction est annulée et doit être relancée" — vérifié indépendamment
  // du fournisseur, qui peut ne jamais se prononcer sur une transaction
  // abandonnée par le client (ex. USSD fermé sans saisir l'OTP).
  it("EXPIREE : une transaction dont le délai de validation est dépassé expire sans jamais interroger le fournisseur", async () => {
    const transaction = await initierPaiementMobile(db, fournisseur, {
      idFacture,
      numeroTelephone: "690000000",
      montant: 5000,
      parcours: "USSD_CLIENT",
    });
    db.update(schema.transactionMobileMoney)
      .set({ dateExpiration: "2020-01-01T00:00:00.000Z" })
      .where(eq(schema.transactionMobileMoney.idTransaction, transaction.idTransaction))
      .run();

    const resultat = await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);

    expect(resultat.statut).toBe("EXPIREE");
    expect(fournisseur.appelsConsulterStatut).toBe(0);
    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
    expect(facture?.statut).toBe("BROUILLON");
    expect(db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, idFacture)).all()).toHaveLength(0);
  });

  it("n'expire pas une transaction encore dans son délai de validation", async () => {
    const transaction = await initierPaiementMobile(db, fournisseur, {
      idFacture,
      numeroTelephone: "690000000",
      montant: 5000,
      parcours: "USSD_CLIENT",
    });

    const resultat = await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);

    expect(resultat.statut).toBe("EN_ATTENTE");
    expect(fournisseur.appelsConsulterStatut).toBe(1);
  });

  it("est idempotent : appelée deux fois après EXPIREE, reste EXPIREE", async () => {
    const transaction = await initierPaiementMobile(db, fournisseur, {
      idFacture,
      numeroTelephone: "690000000",
      montant: 5000,
      parcours: "USSD_CLIENT",
    });
    db.update(schema.transactionMobileMoney)
      .set({ dateExpiration: "2020-01-01T00:00:00.000Z" })
      .where(eq(schema.transactionMobileMoney.idTransaction, transaction.idTransaction))
      .run();

    await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);
    const resultat = await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);

    expect(resultat.statut).toBe("EXPIREE");
    expect(fournisseur.appelsConsulterStatut).toBe(0);
  });
});

// 6.2, 6.6 : la commission CANAL+ d'un recrutement avec kit payé par Mobile
// Money n'est calculée qu'à la confirmation différée du paiement — jamais à
// l'appel initial (montant_encaisse=0 à cet instant, voir recrutement.service.ts)
describe("actualiserStatutTransaction — suivi de commission CANAL+ différé (6.2, 6.6)", () => {
  function creerAbonnementCanalplus() {
    const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    const formule = db.insert(schema.formule).values({ idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get();
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Client", prenom: "Test", telephone: "690000000" }).returning().get();
    return db
      .insert(schema.abonnement)
      .values({ idAbonne: abonne.idAbonne, idFormule: formule.idFormule, siteId, dateDebut: "2026-09-15", dateFin: "2026-10-14", creePar: userId })
      .returning()
      .get();
  }

  it("REUSSIE : crée le suivi de commission à partir de l'entrée en attente, puis la supprime", async () => {
    const abonnement = creerAbonnementCanalplus();
    db.insert(schema.commissionCanalplusEnAttente)
      .values({ idFacture, numeroAbonnement: abonnement.numeroAbonnement, vendeurId: userId, montantCommission: 2900, dateFinProbatoire: "2027-01-12" })
      .run();

    const transaction = await initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" });
    fournisseur.statut = "REUSSIE";
    await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);

    const suivi = db
      .select()
      .from(schema.suiviCommissionCanalplus)
      .where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, abonnement.numeroAbonnement))
      .get();
    expect(suivi?.montantCommission).toBe(2900);
    expect(suivi?.statut).toBe("EN_COURS");
    expect(suivi?.dateFinProbatoire).toBe("2027-01-12");

    const enAttente = db.select().from(schema.commissionCanalplusEnAttente).where(eq(schema.commissionCanalplusEnAttente.idFacture, idFacture)).get();
    expect(enAttente).toBeUndefined();
  });

  it("REUSSIE : n'affecte rien si aucune commission n'était en attente pour cette facture", async () => {
    const transaction = await initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" });
    fournisseur.statut = "REUSSIE";
    await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);

    expect(db.select().from(schema.suiviCommissionCanalplus).all()).toHaveLength(0);
  });

  it("est idempotent : appelée deux fois après REUSSIE, ne crée qu'un seul suivi", async () => {
    const abonnement = creerAbonnementCanalplus();
    db.insert(schema.commissionCanalplusEnAttente)
      .values({ idFacture, numeroAbonnement: abonnement.numeroAbonnement, vendeurId: userId, montantCommission: 2900, dateFinProbatoire: "2027-01-12" })
      .run();

    const transaction = await initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" });
    fournisseur.statut = "REUSSIE";
    await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);
    await actualiserStatutTransaction(db, fournisseur, transaction.idTransaction, userId);

    expect(db.select().from(schema.suiviCommissionCanalplus).all()).toHaveLength(1);
  });
});

// 6.6 : constaté par fuzz de types — un montant « abc », 1.5 ou 1e30 passait la
// garde `<= 0` et créait une transaction Mobile Money au montant illisible.
describe("initierPaiementMobile : entrées invalides (6.6)", () => {
  it.each(["abc", 1.5, Number.NaN, 1e30, 0, -5, null, undefined])("refuse le montant %s sans créer de transaction", async (montant) => {
    await expect(
      initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: montant as never, parcours: "USSD_CLIENT" })
    ).rejects.toThrow(/montant du paiement mobile/i);
    expect(db.select().from(schema.transactionMobileMoney).all()).toHaveLength(0);
  });

  it.each([123, { x: 1 }, "", undefined])("refuse le numéro de téléphone %s", async (numeroTelephone) => {
    await expect(
      initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: numeroTelephone as never, montant: 5000, parcours: "USSD_CLIENT" })
    ).rejects.toThrow(/téléphone/i);
    expect(db.select().from(schema.transactionMobileMoney).all()).toHaveLength(0);
  });

  it.each(["BITCOIN", { x: 1 }, undefined])("refuse le parcours %s", async (parcours) => {
    await expect(
      initierPaiementMobile(db, fournisseur, { idFacture, numeroTelephone: "690000000", montant: 5000, parcours: parcours as never })
    ).rejects.toThrow(/parcours/i);
  });
});

// Constaté à la lecture du service et confirmé par test : le numéro de téléphone n'était pas contrôlé,
// le montant n'avait aucun plafond et pouvait dépasser le solde dû de la facture (le client aurait été
// débité de trop), une facture d'avoir pouvait être « payée », et une panne du fournisseur laissait la
// transaction INITIEE sans référence, ce qui bloquait toute nouvelle tentative pendant 5 minutes.
describe("initierPaiementMobile : contrôles de saisie et solde dû (6.6)", () => {
  const params = (surcharge: object = {}) => ({ idFacture, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" as const, ...surcharge });

  it.each([
    ["des lettres", "abcdef"],
    ["moins de 6 chiffres", "12345"],
    ["un texte de 5 000 caractères", "6".repeat(5000)],
  ])("refuse un numéro de téléphone contenant %s", async (_libelle, numeroTelephone) => {
    await expect(initierPaiementMobile(db, fournisseur, params({ numeroTelephone }))).rejects.toThrow(/téléphone/i);
    expect(db.select().from(schema.transactionMobileMoney).all()).toHaveLength(0);
  });

  it("enregistre le numéro nettoyé", async () => {
    const transaction = await initierPaiementMobile(db, fournisseur, params({ numeroTelephone: " 690 00 00 00 " }));

    expect(transaction.numeroTelephone).toBe("690 00 00 00");
  });

  it("refuse un montant supérieur au solde dû de la facture, sans rien enregistrer", async () => {
    await expect(initierPaiementMobile(db, fournisseur, params({ montant: 6000 }))).rejects.toThrow(/dépasse le solde dû/i);
    expect(db.select().from(schema.transactionMobileMoney).all()).toHaveLength(0);
  });

  it("accepte un montant égal au solde, ou inférieur (paiement partiel)", async () => {
    expect((await initierPaiementMobile(db, fournisseur, params({ montant: 5000 }))).montant).toBe(5000);
  });

  it("tient compte des paiements déjà encaissés et des avoirs pour calculer le solde dû", async () => {
    db.insert(schema.paiement).values({ idFacture, mode: "CASH", montant: 2000, utilisateurId: userId }).run();
    await expect(initierPaiementMobile(db, fournisseur, params({ montant: 4000 }))).rejects.toThrow(/solde dû.*3 ?000/i);

    db.insert(schema.facture).values({ siteId, type: "AVOIR", factureOrigineId: idFacture, montantTotal: -1000, creePar: userId }).run();
    await expect(initierPaiementMobile(db, fournisseur, params({ montant: 3000 }))).rejects.toThrow(/solde dû.*2 ?000/i);
    expect((await initierPaiementMobile(db, fournisseur, params({ montant: 2000 }))).montant).toBe(2000);
  });

  it("refuse de payer une facture d'avoir", async () => {
    const avoir = db.insert(schema.facture).values({ siteId, type: "AVOIR", factureOrigineId: idFacture, montantTotal: -1000, creePar: userId }).returning().get();

    await expect(initierPaiementMobile(db, fournisseur, params({ idFacture: avoir.idFacture, montant: 500 }))).rejects.toThrow(/avoir/i);
  });

  it("refuse un montant au-delà du plafond", async () => {
    await expect(initierPaiementMobile(db, fournisseur, params({ montant: 1_000_000_001 }))).rejects.toThrow(/ne peut pas dépasser/i);
  });

  it("marque la transaction ECHOUEE quand le fournisseur est injoignable, pour pouvoir réessayer aussitôt", async () => {
    const enPanne = { initier: async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:443"); }, consulterStatut: async () => "EN_ATTENTE" as StatutFournisseur };

    await expect(initierPaiementMobile(db, enPanne, params())).rejects.toThrow(/Orange Money.*(joint|disponible)/i);

    const [transaction] = db.select().from(schema.transactionMobileMoney).all();
    expect(transaction.statut).toBe("ECHOUEE");
    expect((await initierPaiementMobile(db, fournisseur, params())).statut).toBe("EN_ATTENTE");
  });
});
