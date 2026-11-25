import { describe, it, expect, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { creerDbTest, type Db } from "./test-utils/db.js";
import * as schema from "./db/schema.js";
import { creerVenteProduits } from "./modules/ventes/vente.service.js";
import { encaisserSoldeFacture } from "./modules/factures/paiement-complementaire.service.js";
import { creerAvoir, listerLignesFacture } from "./modules/factures/avoir.service.js";
import { annulerPaiement } from "./modules/factures/annulation-paiement.service.js";
import { annulerFactureEnAttente, listerVentesEnAttente } from "./modules/factures/annulation-facture.service.js";
import { affecterPieceSav, changerStatutSav } from "./modules/sav/sav.service.js";

// Test grandeur nature « paiements et SAV » : les cinq défauts constatés.

let db: Db;
let siteId: number;
let userId: number;
let idAbonne: number;
let idProduit: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasseHash: "h", role: "GERANT" }).returning().get().idUser;
  idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555" }).returning().get().idAbonne;
  idProduit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, suiviStock: 1, quantiteStock: 50 }).returning().get().idProduit;
});

const aujourdHui = () => new Date().toISOString().slice(0, 10);
const cheque = () => ({ modePaiement: "CHEQUE" as const, banque: "Afriland", numeroCheque: "0012345", titulaireCheque: "M. Test", dateCheque: aujourdHui() });
const virement = { modePaiement: "VIREMENT" as const, banque: "UBA", referenceVirement: "VIR-001" };
const nombre = (table: typeof schema.facture | typeof schema.paiement | typeof schema.notification | typeof schema.ligneVente) =>
  db.select({ n: sql<number>`count(*)` }).from(table).get()!.n;
const paiementsDe = (idFacture: number) => db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, idFacture)).all();
const totalPaye = (idFacture: number) => paiementsDe(idFacture).reduce((s, p) => s + p.montant, 0);
const facture = (idFacture: number) => db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get()!;
const stock = () => db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduit)).get()!.quantiteStock;
const vendre = (quantite: number, montantEncaisse: number, extra: Record<string, unknown> = {}) =>
  creerVenteProduits(db, { siteId, userId, idAbonne, lignes: [{ idProduit, quantite }], montantEncaisse, ...extra });

describe("défaut 1 : un chèque ou un virement ne dépasse jamais le solde dû", () => {
  it.each([
    ["chèque", () => cheque()],
    ["virement", () => virement],
  ])("vente payée par %s au-delà du total : refusée, rien n'est écrit", (_nom, mode) => {
    expect(() => vendre(1, 25000, mode())).toThrow(/dépasse le solde dû de la facture \(2 500 FCFA\)/);

    expect(nombre(schema.facture)).toBe(0);
    expect(nombre(schema.paiement)).toBe(0);
    expect(stock()).toBe(50);
  });

  it("le montant exact passe, comme un chèque partiel", () => {
    expect(totalPaye(vendre(2, 5000, cheque()).idFacture)).toBe(5000);
    expect(totalPaye(vendre(2, 1000, virement).idFacture)).toBe(1000);
  });

  it("encaissement complémentaire : refusé au-delà du solde restant, accepté au solde exact", () => {
    const { idFacture } = vendre(10, 5000); // 25 000, acompte 5 000
    expect(() => encaisserSoldeFacture(db, { idFacture, userId, montant: 20001, ...cheque() })).toThrow(/dépasse le solde dû/);
    expect(totalPaye(idFacture)).toBe(5000);

    encaisserSoldeFacture(db, { idFacture, userId, montant: 20000, ...cheque() });
    expect(totalPaye(idFacture)).toBe(25000);
  });

  it("les espèces gardent le rendu de monnaie", () => {
    expect(totalPaye(vendre(1, 10000).idFacture)).toBe(2500);
  });
});

describe("défaut 2 : un avoir ne reprend jamais plus que ce qui a été facturé", () => {
  // 3 × 2 500 − 1 FCFA de remise = 7 499 : le prix unitaire ne tombe pas juste
  const venteRemisee = () => creerVenteProduits(db, { siteId, userId, idAbonne, lignes: [{ idProduit, quantite: 3, remise: 1 }], montantEncaisse: 7499 }).idFacture;
  const ligneDe = (idFacture: number) => listerLignesFacture(db, idFacture)[0];

  it("avoir total remboursé : exactement 7 499, et la facture revient à zéro encaissé", () => {
    const idFacture = venteRemisee();
    const avoir = creerAvoir(db, { idFactureOrigine: idFacture, lignes: [{ idLigneOrigine: ligneDe(idFacture).idLigne, quantite: 3 }], restituerStock: false, userId, remboursement: { mode: "CASH" } });

    expect(avoir.montantTotal).toBe(-7499);
    expect(avoir.montantRembourse).toBe(7499);
    expect(totalPaye(idFacture)).toBe(0);
  });

  it("article par article : la somme des trois avoirs est exactement le montant facturé", () => {
    const idFacture = venteRemisee();
    const idLigneOrigine = ligneDe(idFacture).idLigne;
    const montants = [1, 2, 3].map(() => creerAvoir(db, { idFactureOrigine: idFacture, lignes: [{ idLigneOrigine, quantite: 1 }], restituerStock: false, userId, remboursement: { mode: "CASH" } }).montantTotal);

    expect(montants).toEqual([-2500, -2499, -2500]);
    expect(totalPaye(idFacture)).toBe(0);
  });

  it("les lignes disent ce qui a déjà été crédité en francs", () => {
    const idFacture = venteRemisee();
    const idLigneOrigine = ligneDe(idFacture).idLigne;
    expect(ligneDe(idFacture).montantDejaCredite).toBe(0);
    creerAvoir(db, { idFactureOrigine: idFacture, lignes: [{ idLigneOrigine, quantite: 2 }], restituerStock: false, userId });

    expect(ligneDe(idFacture)).toMatchObject({ quantiteDisponible: 1, montantDejaCredite: 4999 });
  });
});

describe("défaut 3 : un paiement Mobile Money confirmé par l'opérateur ne s'efface pas", () => {
  function venteConfirmeeParMobile() {
    const { idFacture } = vendre(2, 0, { paiementMobileDiffere: true });
    db.insert(schema.transactionMobileMoney)
      .values({ idFacture, parcours: "PUSH_MARCHAND", numeroTelephone: "699000000", montant: 5000, statut: "REUSSIE", referenceTransaction: "REF-1", dateExpiration: new Date().toISOString() })
      .run();
    const paiement = db.insert(schema.paiement).values({ idFacture, mode: "MOBILE_MONEY", montant: 5000, utilisateurId: userId, referenceTransaction: "REF-1" }).returning().get();
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, idFacture)).run();
    return { idFacture, idPaiement: paiement.idPaiement };
  }

  it("son annulation est refusée : le client a été débité", () => {
    const { idFacture, idPaiement } = venteConfirmeeParMobile();

    expect(() => annulerPaiement(db, { idPaiement, userId })).toThrow(/confirmé par l'opérateur.*avoir/);
    expect(totalPaye(idFacture)).toBe(5000);
    expect(facture(idFacture).statut).toBe("VALIDEE");
  });

  // une base d'avant la correction peut porter une vente repassée en brouillon dont la transaction a réussi
  it("la vente dont une transaction a réussi ne s'annule pas, et la liste dit pourquoi", () => {
    const { idFacture, idPaiement } = venteConfirmeeParMobile();
    db.delete(schema.paiement).where(eq(schema.paiement.idPaiement, idPaiement)).run();
    db.update(schema.facture).set({ statut: "BROUILLON" }).where(eq(schema.facture.idFacture, idFacture)).run();

    expect(listerVentesEnAttente(db, siteId).find((v) => v.idFacture === idFacture)?.blocage).toMatch(/Mobile Money.*débité/);
    expect(() => annulerFactureEnAttente(db, { idFacture, userId })).toThrow(/Mobile Money.*débité/);
    expect(db.select().from(schema.transactionMobileMoney).all()).toHaveLength(1);
  });

  it("une vente dont la transaction a échoué s'annule toujours", () => {
    const { idFacture } = vendre(1, 0, { paiementMobileDiffere: true });
    db.insert(schema.transactionMobileMoney)
      .values({ idFacture, parcours: "PUSH_MARCHAND", numeroTelephone: "699000000", montant: 2500, statut: "ECHOUEE", dateExpiration: new Date().toISOString() })
      .run();

    annulerFactureEnAttente(db, { idFacture, userId });
    expect(nombre(schema.facture)).toBe(0);
  });
});

describe("défaut 4 : on n'annule pas un encaissement qui a déjà été remboursé", () => {
  function venteRemboursee() {
    const { idFacture } = vendre(2, 5000);
    creerAvoir(db, { idFactureOrigine: idFacture, lignes: [{ idLigneOrigine: listerLignesFacture(db, idFacture)[0].idLigne, quantite: 2 }], restituerStock: false, userId, remboursement: { mode: "CASH" } });
    const [encaissement, remboursement] = paiementsDe(idFacture);
    return { idFacture, encaissement, remboursement };
  }

  it("l'annulation est refusée tant que le remboursement existe", () => {
    const { idFacture, encaissement } = venteRemboursee();

    expect(() => annulerPaiement(db, { idPaiement: encaissement.idPaiement, userId })).toThrow(/remboursement.*annulez d'abord le remboursement/i);
    expect(paiementsDe(idFacture)).toHaveLength(2);
    expect(db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "paiement")).all()).toHaveLength(0);
  });

  it("une fois le remboursement annulé, l'encaissement s'annule et la facture repasse en brouillon", () => {
    const { idFacture, encaissement, remboursement } = venteRemboursee();

    annulerPaiement(db, { idPaiement: remboursement.idPaiement, userId });
    expect(annulerPaiement(db, { idPaiement: encaissement.idPaiement, userId })).toMatchObject({ totalPaye: 0, statutFacture: "BROUILLON" });
    expect(paiementsDe(idFacture)).toHaveLength(0);
  });

  it("un second encaissement reste annulable tant que les remboursements restent couverts", () => {
    const { idFacture } = vendre(10, 20000); // 25 000
    encaisserSoldeFacture(db, { idFacture, userId, montant: 5000 });
    const ligne = listerLignesFacture(db, idFacture)[0];
    creerAvoir(db, { idFactureOrigine: idFacture, lignes: [{ idLigneOrigine: ligne.idLigne, quantite: 1 }], restituerStock: false, userId, remboursement: { mode: "CASH" } });
    const solde = paiementsDe(idFacture).find((p) => p.montant === 5000)!;

    expect(annulerPaiement(db, { idPaiement: solde.idPaiement, userId })).toMatchObject({ totalPaye: 17500, statutFacture: "VALIDEE" });
  });
});

describe("défaut 5 : les changements de statut SAV s'écrivent en entier ou pas du tout", () => {
  function dossierEnReparation() {
    const idDossierSav = db.insert(schema.savDossier).values({ siteId, idAbonne, descriptionPanne: "Panne", statut: "REPARATION" }).returning().get().idDossierSav;
    affecterPieceSav(db, { idDossierSav, idProduit, quantite: 1, userId });
    return idDossierSav;
  }
  const panne = (table: string, condition: string) =>
    db.$client.exec(`CREATE TRIGGER panne BEFORE ${table === "sav_historique" ? "INSERT" : "UPDATE"} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'panne simulée'); END`);
  const reparer = () => db.$client.exec("DROP TRIGGER panne");
  const dossier = (id: number) => db.select().from(schema.savDossier).where(eq(schema.savDossier.idDossierSav, id)).get()!;

  it.each([
    ["à l'écriture du dossier", "sav_dossier", "NEW.statut = 'PRET'"],
    ["à l'écriture de l'historique", "sav_historique", "NEW.statut_apres = 'PRET'"],
  ])("panne au passage en « Prêt » (%s) : ni facture, ni ligne, ni SMS ; la reprise ne facture qu'une fois", (_nom, table, condition) => {
    const idDossierSav = dossierEnReparation();
    panne(table, condition);

    expect(() => changerStatutSav(db, { idDossierSav, nouveauStatut: "PRET", montantMainOeuvre: 7000, userId })).toThrow("panne simulée");
    expect(nombre(schema.facture)).toBe(0);
    expect(nombre(schema.ligneVente)).toBe(0);
    expect(nombre(schema.notification)).toBe(0);
    expect(dossier(idDossierSav)).toMatchObject({ statut: "REPARATION", idFacture: null });

    reparer();
    changerStatutSav(db, { idDossierSav, nouveauStatut: "PRET", montantMainOeuvre: 7000, userId });
    expect(nombre(schema.facture)).toBe(1);
    expect(nombre(schema.notification)).toBe(1);
    expect(dossier(idDossierSav).statut).toBe("PRET");
  });

  it("panne à la livraison : rien n'est encaissé et la facture reste en brouillon", () => {
    const idDossierSav = dossierEnReparation();
    const { idFacture } = changerStatutSav(db, { idDossierSav, nouveauStatut: "PRET", montantMainOeuvre: 7000, userId });
    panne("sav_dossier", "NEW.statut = 'LIVRE'");

    expect(() => changerStatutSav(db, { idDossierSav, nouveauStatut: "LIVRE", montantEncaisse: 9500, userId })).toThrow("panne simulée");
    expect(totalPaye(idFacture!)).toBe(0);
    expect(facture(idFacture!).statut).toBe("BROUILLON");
    expect(dossier(idDossierSav).statut).toBe("PRET");
  });

  it("livraison par chèque au-delà du dû : refusée, le dossier reste « Prêt »", () => {
    const idDossierSav = dossierEnReparation();
    const { idFacture } = changerStatutSav(db, { idDossierSav, nouveauStatut: "PRET", montantMainOeuvre: 7000, userId });

    expect(() => changerStatutSav(db, { idDossierSav, nouveauStatut: "LIVRE", montantEncaisse: 50000, userId, ...cheque() })).toThrow(/dépasse le solde dû/);
    expect(totalPaye(idFacture!)).toBe(0);
    expect(dossier(idDossierSav).statut).toBe("PRET");
  });
});
