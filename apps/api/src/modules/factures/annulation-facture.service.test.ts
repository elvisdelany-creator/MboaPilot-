import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { creerVenteProduits } from "../ventes/vente.service.js";
import { recruterAbonne } from "../abonnements/recrutement.service.js";
import { annulerFactureEnAttente, listerVentesEnAttente } from "./annulation-facture.service.js";

let db: Db;
let siteId: number;
let userId: number;
let idBien: number;
let idService: number;

const stock = () => db.select().from(schema.produit).where(eq(schema.produit.idProduit, idBien)).get()!.quantiteStock;
const factures = () => db.select().from(schema.facture).all();

// vente dont le paiement Mobile Money n'a jamais abouti : facture BROUILLON, stock déjà sorti, aucun encaissement
const venteEnAttente = (quantite = 3, extra: { idAbonne?: number } = {}) =>
  creerVenteProduits(db, { siteId, userId, ...extra, lignes: [{ idProduit: idBien, quantite }], montantEncaisse: 0, paiementMobileDiffere: true });

const transactionMobile = (idFacture: number, statut: "INITIEE" | "EN_ATTENTE" | "REUSSIE" | "ECHOUEE" | "EXPIREE", dateExpiration = "2099-01-01T00:00:00.000Z") =>
  db
    .insert(schema.transactionMobileMoney)
    .values({ idFacture, parcours: "USSD_CLIENT", numeroTelephone: "690000000", montant: 7500, statut, dateExpiration })
    .run();

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "G", prenom: "Gérant", identifiant: "gerant", motDePasseHash: "h", role: "GERANT" })
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

// 6.4 : un BROUILLON « reste modifiable sans restriction » ; 9.1, 11.5 : toute suppression est confirmée et tracée.
// Une vente Mobile Money jamais payée laissait sa facture BROUILLON et son stock sorti pour toujours, sans issue.
describe("annulerFactureEnAttente : vente de produits jamais encaissée", () => {
  it("restitue le stock, supprime la facture et ses lignes, et journalise la suppression", () => {
    const vente = venteEnAttente(3);
    expect(stock()).toBe(7);

    const resultat = annulerFactureEnAttente(db, { idFacture: vente.idFacture, userId });

    expect(resultat).toMatchObject({ idFacture: vente.idFacture, montantTotal: 7500 });
    expect(stock()).toBe(10);
    expect(factures()).toHaveLength(0);
    expect(db.select().from(schema.ligneVente).all()).toHaveLength(0);

    const retour = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.typeMouvement, "RETOUR_CLIENT")).all();
    expect(retour).toHaveLength(1);
    expect(retour[0]).toMatchObject({ idProduit: idBien, quantite: 3, utilisateurId: userId });
    expect(retour[0].motif).toContain(`facture n° ${vente.idFacture}`);

    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "facture")).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "SUPPRESSION", idCible: String(vente.idFacture), utilisateurId: userId });
    expect(JSON.parse(audit[0].valeurAvant!)).toMatchObject({ idFacture: vente.idFacture, montantTotal: 7500, lignes: [{ idProduit: idBien, quantite: 3 }] });
  });

  it("ne touche pas au stock d'un service, qui n'en a pas", () => {
    const vente = creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idService, quantite: 1 }], montantEncaisse: 0, paiementMobileDiffere: true });

    annulerFactureEnAttente(db, { idFacture: vente.idFacture, userId });

    expect(db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.typeMouvement, "RETOUR_CLIENT")).all()).toHaveLength(0);
    expect(factures()).toHaveLength(0);
  });

  it("supprime aussi les transactions Mobile Money échouées ou expirées de la facture", () => {
    const vente = venteEnAttente(1);
    transactionMobile(vente.idFacture, "ECHOUEE");
    transactionMobile(vente.idFacture, "EXPIREE");

    annulerFactureEnAttente(db, { idFacture: vente.idFacture, userId });

    expect(db.select().from(schema.transactionMobileMoney).all()).toHaveLength(0);
    expect(factures()).toHaveLength(0);
  });

  it("refuse tant qu'un paiement Mobile Money est en cours, sans rien modifier", () => {
    const vente = venteEnAttente(3);
    transactionMobile(vente.idFacture, "EN_ATTENTE");

    expect(() => annulerFactureEnAttente(db, { idFacture: vente.idFacture, userId })).toThrow(/en cours/i);

    expect(stock()).toBe(7);
    expect(factures()).toHaveLength(1);
  });

  // le statut Mobile Money n'est actualisé qu'à la demande : c'est la date d'expiration qui dit si le paiement peut encore aboutir
  it("accepte une transaction restée EN_ATTENTE dont le délai de validation est dépassé : elle ne peut plus aboutir", () => {
    const vente = venteEnAttente(3);
    transactionMobile(vente.idFacture, "EN_ATTENTE", "2020-01-01T00:00:00.000Z");
    expect(listerVentesEnAttente(db, siteId)[0].paiementEnCours).toBe(false);

    annulerFactureEnAttente(db, { idFacture: vente.idFacture, userId });

    expect(stock()).toBe(10);
    expect(factures()).toHaveLength(0);
  });

  it("refuse une facture déjà validée (encaissement enregistré) : la correction passe par un avoir", () => {
    const vente = creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idBien, quantite: 1 }], montantEncaisse: 2500 });

    expect(() => annulerFactureEnAttente(db, { idFacture: vente.idFacture, userId })).toThrow(/avoir/i);

    expect(factures()).toHaveLength(1);
    expect(stock()).toBe(9);
  });

  it("refuse une facture introuvable", () => {
    expect(() => annulerFactureEnAttente(db, { idFacture: 999, userId })).toThrow(/introuvable/i);
  });

  it("refuse un avoir", () => {
    const vente = creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idBien, quantite: 1 }], montantEncaisse: 2500 });
    const avoir = db.insert(schema.facture).values({ siteId, creePar: userId, type: "AVOIR", factureOrigineId: vente.idFacture, montantTotal: -2500 }).returning().get();

    expect(() => annulerFactureEnAttente(db, { idFacture: avoir.idFacture, userId })).toThrow(/avoir/i);
  });

  it("refuse une facture qui porte un abonnement ou un kit : elle ne s'annule pas sans l'abonnement", () => {
    const vente = venteEnAttente(1);
    db.insert(schema.ligneVente).values({ idFacture: vente.idFacture, idProduit: null, quantite: 1, prixApplique: 15500 }).run();

    expect(() => annulerFactureEnAttente(db, { idFacture: vente.idFacture, userId })).toThrow(/abonnement|vente de produits/i);

    expect(stock()).toBe(9);
    expect(factures()).toHaveLength(1);
  });

  it("restitue chaque ligne d'une facture à plusieurs articles", () => {
    const vente = creerVenteProduits(db, {
      siteId,
      userId,
      lignes: [
        { idProduit: idBien, quantite: 2 },
        { idProduit: idService, quantite: 1 },
      ],
      montantEncaisse: 0,
      paiementMobileDiffere: true,
    });
    expect(stock()).toBe(8);

    annulerFactureEnAttente(db, { idFacture: vente.idFacture, userId });

    expect(stock()).toBe(10);
  });
});

describe("listerVentesEnAttente", () => {
  it("liste les ventes de produits jamais encaissées du site, avec client, articles et état du paiement mobile", () => {
    const idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Mballa", prenom: "Sylvie", telephone: "690000001" }).returning().get().idAbonne;
    const anonyme = venteEnAttente(2);
    const nominative = venteEnAttente(1, { idAbonne });
    transactionMobile(nominative.idFacture, "EN_ATTENTE");

    const liste = listerVentesEnAttente(db, siteId);

    expect(liste.map((v) => v.idFacture).sort()).toEqual([anonyme.idFacture, nominative.idFacture].sort());
    const a = liste.find((v) => v.idFacture === anonyme.idFacture)!;
    expect(a).toMatchObject({ montantTotal: 5000, client: null, paiementEnCours: false, lignes: [{ libelle: "Télécommande universelle", quantite: 2 }] });
    const n = liste.find((v) => v.idFacture === nominative.idFacture)!;
    expect(n).toMatchObject({ client: "Sylvie Mballa", paiementEnCours: true });
  });

  it("exclut les ventes encaissées, les avoirs, les autres sites et les factures d'abonnement", () => {
    creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: idBien, quantite: 1 }], montantEncaisse: 2500 });
    const abonnement = venteEnAttente(1);
    db.insert(schema.ligneVente).values({ idFacture: abonnement.idFacture, idProduit: null, quantite: 1, prixApplique: 15500 }).run();
    const autreEnt = db.insert(schema.entreprise).values({ nom: "Autre" }).returning().get();
    const autreSite = db.insert(schema.site).values({ idEntreprise: autreEnt.idEntreprise, nom: "Site B" }).returning().get().idSite;
    db.insert(schema.facture).values({ siteId: autreSite, creePar: userId, montantTotal: 1000 }).run();

    expect(listerVentesEnAttente(db, siteId)).toEqual([]);
  });
});

// 7.1, 6.6 : un recrutement dont le paiement Mobile Money n'aboutit jamais laissait un abonnement ACTIF jamais payé, sa commission
// « en attente » et le matériel du kit sorti du stock. Il s'annule en bloc ; réabonnement, changement de formule et échange, qui
// modifient un abonnement existant, ne s'annulent pas ici.
describe("annulerFactureEnAttente : recrutement jamais payé", () => {
  let idDecodeur: number;
  let idKit: number;
  let idFormule: number;

  const decodeurs = () => db.select().from(schema.produit).where(eq(schema.produit.idProduit, idDecodeur)).get()!.quantiteStock;
  const recrutementEnAttente = (avecKit = true) =>
    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2026-10-01",
      abonne: { nom: "Ngo", prenom: "Paul", telephone: "677000555" },
      idFormule,
      ...(avecKit ? { idKit } : {}),
      montantEncaisse: 0,
    });

  beforeEach(() => {
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
    const formule = db.insert(schema.formule).values({ idFamille: famille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get();
    idFormule = formule.idFormule;
    idKit = db
      .insert(schema.kit)
      .values({ idFamille: famille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", prixParaboleAccessoires: 0 })
      .returning()
      .get().idKit;
    db.insert(schema.kitPrixDecodeur).values({ idKit, idFormule, prixDecodeur: 5000 }).run();
    idDecodeur = db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Décodeur GLOBALZ", prixVente: 5000, suiviStock: 1, quantiteStock: 5 })
      .returning()
      .get().idProduit;
    db.insert(schema.kitComposant).values({ idKit, idProduit: idDecodeur, quantite: 1 }).run();
  });

  it("supprime l'abonnement, son matériel, la commission en attente et la facture, remet le matériel du kit en stock, et journalise", () => {
    const recrutement = recrutementEnAttente();
    expect(decodeurs()).toBe(4);
    expect(db.select().from(schema.abonnement).all()).toHaveLength(1);

    const resultat = annulerFactureEnAttente(db, { idFacture: recrutement.idFacture, userId });

    expect(resultat.idFacture).toBe(recrutement.idFacture);
    expect(decodeurs()).toBe(5);
    expect(db.select().from(schema.abonnement).all()).toHaveLength(0);
    expect(db.select().from(schema.materielAbonne).all()).toHaveLength(0);
    expect(db.select().from(schema.commissionCanalplusEnAttente).all()).toHaveLength(0);
    expect(db.select().from(schema.ligneVente).all()).toHaveLength(0);
    expect(factures()).toHaveLength(0);

    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "facture")).all();
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].valeurAvant!)).toMatchObject({ idFacture: recrutement.idFacture, abonnement: { numeroAbonnement: recrutement.numeroAbonnement, dateFin: "2026-10-30" } });
  });

  it("conserve le client créé à la caisse : il peut revenir, et d'autres données peuvent s'y rattacher", () => {
    const recrutement = recrutementEnAttente();
    annulerFactureEnAttente(db, { idFacture: recrutement.idFacture, userId });

    expect(db.select().from(schema.abonne).all()).toHaveLength(1);
  });

  it("annule aussi un recrutement sans kit, et supprime les alertes d'échéance déjà envoyées", () => {
    const recrutement = recrutementEnAttente(false);
    db.insert(schema.alerteEcheance).values({ numeroAbonnement: recrutement.numeroAbonnement, jalonJours: 7, dateDeclenchement: "2026-10-23" }).run();

    annulerFactureEnAttente(db, { idFacture: recrutement.idFacture, userId });

    expect(decodeurs()).toBe(5);
    expect(db.select().from(schema.abonnement).all()).toHaveLength(0);
    expect(db.select().from(schema.alerteEcheance).all()).toHaveLength(0);
  });

  it("refuse une facture de réabonnement ou de changement : l'abonnement existe déjà et porte d'autres factures", () => {
    const recrutement = recrutementEnAttente();
    const suivante = db.insert(schema.facture).values({ siteId, creePar: userId, montantTotal: 10500 }).returning().get();
    db.insert(schema.ligneVente).values({ idFacture: suivante.idFacture, numeroAbonnement: recrutement.numeroAbonnement, prixApplique: 10500 }).run();

    expect(() => annulerFactureEnAttente(db, { idFacture: suivante.idFacture, userId })).toThrow(/abonnement/i);

    expect(db.select().from(schema.abonnement).all()).toHaveLength(1);
    expect(factures()).toHaveLength(2);
  });

  it("refuse un recrutement dont l'abonnement a déjà évolué (historique de changement)", () => {
    const recrutement = recrutementEnAttente();
    db.insert(schema.historiqueAbonnement).values({ numeroAbonnement: recrutement.numeroAbonnement, typeChangement: "STATUT", valeurAvant: "ACTIF", valeurApres: "EXPIRE" }).run();

    expect(() => annulerFactureEnAttente(db, { idFacture: recrutement.idFacture, userId })).toThrow(/abonnement/i);

    expect(db.select().from(schema.abonnement).all()).toHaveLength(1);
    expect(decodeurs()).toBe(4);
  });

  it("refuse tant qu'un paiement Mobile Money est en cours", () => {
    const recrutement = recrutementEnAttente();
    transactionMobile(recrutement.idFacture, "EN_ATTENTE");

    expect(() => annulerFactureEnAttente(db, { idFacture: recrutement.idFacture, userId })).toThrow(/en cours/i);

    expect(db.select().from(schema.abonnement).all()).toHaveLength(1);
  });

  it("apparaît dans la liste avec le détail de l'abonnement, du kit et du client", () => {
    const recrutement = recrutementEnAttente();

    const liste = listerVentesEnAttente(db, siteId);

    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({
      idFacture: recrutement.idFacture,
      type: "ABONNEMENT",
      numeroAbonnement: recrutement.numeroAbonnement,
      client: "Paul Ngo",
      paiementEnCours: false,
    });
    expect(liste[0].lignes.map((l) => l.libelle)).toEqual(expect.arrayContaining(["CANAL+ EVASION", "KIT CANAL+ GLOBALZ"]));
  });

  it("une vente de produits de la liste est typée PRODUITS", () => {
    venteEnAttente(1);

    expect(listerVentesEnAttente(db, siteId)[0]).toMatchObject({ type: "PRODUITS", numeroAbonnement: null });
  });
});
