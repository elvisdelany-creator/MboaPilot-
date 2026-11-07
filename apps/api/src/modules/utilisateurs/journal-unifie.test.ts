import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerUtilisateur } from "./utilisateur.repository.js";
import { listerJournalUnifie } from "./audit.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idProduit: number;
let idFormuleA: number;
let idFormuleB: number;

// Constaté en test grandeur nature : après un achat de stock, une casse, un inventaire, un réabonnement et une résiliation, le
// « Journal d'audit » n'avait rien ajouté. Ces gestes sont tracés dans leurs propres historiques (stock, abonnement, prix, SAV) mais
// pas là où la direction cherche « qui a fait quoi » (11.5, 8.7) : le journal les lit désormais tous.
beforeEach(() => {
  db = creerDbTest();
  // les historiques d'abonnement et de SAV pointent vers des fiches que ces tests n'ont pas besoin de créer
  db.$client.pragma("foreign_keys = OFF");
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" }).idUser;
  db.delete(schema.journalAudit).run();
  idProduit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, suiviStock: 1, quantiteStock: 10 }).returning().get().idProduit;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  idFormuleA = db.insert(schema.formule).values({ idFamille: famille, libelle: "EVASION", prix: 10500, rang: 3 }).returning().get().idFormule;
  idFormuleB = db.insert(schema.formule).values({ idFamille: famille, libelle: "ACCESS+", prix: 15000, rang: 4 }).returning().get().idFormule;
});

function mouvement(type: "ACHAT" | "VENTE" | "CASSE" | "INVENTAIRE", quantite: number, date: string, motif: string | null = null, utilisateurId = userId) {
  db.insert(schema.stockMouvement).values({ idProduit, siteId, typeMouvement: type, quantite, motif, dateMouvement: date, utilisateurId }).run();
}

describe("listerJournalUnifie : les gestes tracés dans les historiques (11.5, 8.7)", () => {
  it("fusionne le journal et les quatre historiques, le plus récent en tête", () => {
    db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "MODIFICATION", tableCible: "formule", idCible: "1", dateAction: "2026-11-07 10:00:00" }).run();
    mouvement("ACHAT", 10, "2026-11-07 10:05:00");
    db.insert(schema.historiqueAbonnement).values({ numeroAbonnement: 1, typeChangement: "STATUT", valeurAvant: "ACTIF", valeurApres: "RESILIE", motif: "client parti", utilisateurId: userId, dateChangement: "2026-11-07 10:10:00" }).run();
    db.insert(schema.historiquePrixProduit).values({ idProduit, prixVenteAvant: 2500, prixVenteApres: 3000, coutRevientAvant: 1000, coutRevientApres: 1100, utilisateurId: userId, dateChangement: "2026-11-07 10:15:00" }).run();
    db.insert(schema.savHistorique).values({ idDossierSav: 1, statutAvant: "RECU", statutApres: "EN_DIAGNOSTIC", utilisateurId: userId, dateChangement: "2026-11-07 10:20:00" }).run();

    const journal = listerJournalUnifie(db);

    expect(journal.map((e) => e.tableCible)).toEqual(["sav_historique", "historique_prix_produit", "historique_abonnement", "stock_mouvement", "formule"]);
    expect(journal[0].utilisateurNom).toBe("Nga");
  });

  it("décrit un mouvement de stock : article, type, quantité et motif", () => {
    mouvement("CASSE", 1, "2026-11-07 10:05:00", "carton écrasé");

    const [entree] = listerJournalUnifie(db);

    expect(entree.tableCible).toBe("stock_mouvement");
    expect(entree.action).toBe("CREATION");
    expect(JSON.parse(entree.valeurApres!)).toEqual({ article: "Câble HDMI", typeMouvement: "CASSE", quantite: 1, motif: "carton écrasé" });
  });

  it("laisse de côté les sorties de stock des ventes courantes, qui découlent d'une facture", () => {
    mouvement("VENTE", 2, "2026-11-07 10:05:00");
    mouvement("INVENTAIRE", -3, "2026-11-07 10:06:00", "comptage");

    const journal = listerJournalUnifie(db);

    expect(journal).toHaveLength(1);
    expect(JSON.parse(journal[0].valeurApres!).typeMouvement).toBe("INVENTAIRE");
  });

  it("décrit un changement de statut d'abonnement avec l'avant, l'après et le motif", () => {
    db.insert(schema.historiqueAbonnement).values({ numeroAbonnement: 7, typeChangement: "STATUT", valeurAvant: "ACTIF", valeurApres: "RESILIE", motif: "resiliation : client parti", utilisateurId: userId, dateChangement: "2026-11-07 10:10:00" }).run();

    const [entree] = listerJournalUnifie(db);

    expect(entree.tableCible).toBe("historique_abonnement");
    expect(entree.idCible).toBe("7");
    expect(entree.action).toBe("MODIFICATION");
    expect(JSON.parse(entree.valeurAvant!)).toEqual({ statut: "ACTIF" });
    expect(JSON.parse(entree.valeurApres!)).toEqual({ statut: "RESILIE", motif: "resiliation : client parti" });
  });

  it("nomme les formules (pas leurs numéros) dans un changement de formule", () => {
    db.insert(schema.historiqueAbonnement).values({ numeroAbonnement: 7, typeChangement: "FORMULE", valeurAvant: String(idFormuleA), valeurApres: String(idFormuleB), utilisateurId: userId }).run();

    const [entree] = listerJournalUnifie(db);

    expect(JSON.parse(entree.valeurAvant!)).toEqual({ formule: "EVASION" });
    expect(JSON.parse(entree.valeurApres!)).toEqual({ formule: "ACCESS+" });
  });

  it("décrit un changement de prix d'article", () => {
    db.insert(schema.historiquePrixProduit).values({ idProduit, prixVenteAvant: 2500, prixVenteApres: 3000, coutRevientAvant: 1000, coutRevientApres: 1100, utilisateurId: userId }).run();

    const [entree] = listerJournalUnifie(db);

    expect(entree.tableCible).toBe("historique_prix_produit");
    expect(JSON.parse(entree.valeurAvant!)).toEqual({ article: "Câble HDMI", prixVente: 2500, coutRevient: 1000 });
    expect(JSON.parse(entree.valeurApres!)).toEqual({ article: "Câble HDMI", prixVente: 3000, coutRevient: 1100 });
  });

  it("garde les gestes d'un job automatique (auteur NULL) au lieu de les cacher", () => {
    db.insert(schema.historiqueAbonnement).values({ numeroAbonnement: 3, typeChangement: "STATUT", valeurAvant: "ACTIF", valeurApres: "EXPIRE", utilisateurId: null }).run();

    const [entree] = listerJournalUnifie(db);

    expect(entree.utilisateurId).toBeNull();
    expect(entree.utilisateurNom).toBeNull();
  });

  it("filtre par table cible, y compris sur un historique", () => {
    mouvement("ACHAT", 5, "2026-11-07 10:05:00");
    db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "MODIFICATION", tableCible: "formule", idCible: "1" }).run();

    expect(listerJournalUnifie(db, { tableCible: "stock_mouvement" }).map((e) => e.tableCible)).toEqual(["stock_mouvement"]);
    expect(listerJournalUnifie(db, { tableCible: "formule" }).map((e) => e.tableCible)).toEqual(["formule"]);
    expect(listerJournalUnifie(db, { tableCible: "inconnue" })).toEqual([]);
  });
});

describe("listerJournalUnifie : pagination par curseur (11.5)", () => {
  // des dizaines d'actions à la même seconde, dans des sources différentes : le curseur ne doit ni sauter ni répéter d'entrée
  function remplirALaMemeSeconde(parSource: number) {
    const date = "2026-11-07 10:00:00";
    for (let i = 0; i < parSource; i++) {
      db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "MODIFICATION", tableCible: "formule", idCible: String(i), dateAction: date }).run();
      mouvement("ACHAT", 1, date);
      db.insert(schema.historiqueAbonnement).values({ numeroAbonnement: i, typeChangement: "STATUT", valeurAvant: "ACTIF", valeurApres: "RESILIE", utilisateurId: userId, dateChangement: date }).run();
    }
  }

  it("remonte page après page sans doublon ni trou, même à égalité d'horodatage", () => {
    remplirALaMemeSeconde(7);

    const page1 = listerJournalUnifie(db, { limite: 8 });
    const page2 = listerJournalUnifie(db, { limite: 8, curseur: page1[page1.length - 1].curseur });
    const page3 = listerJournalUnifie(db, { limite: 8, curseur: page2[page2.length - 1].curseur });

    expect([page1.length, page2.length, page3.length]).toEqual([8, 8, 5]);
    const cles = [...page1, ...page2, ...page3].map((e) => e.curseur);
    expect(new Set(cles).size).toBe(21);
  });

  it("applique la même limite que le journal : 200 par défaut, 1 000 au plus", () => {
    remplirALaMemeSeconde(150);

    expect(listerJournalUnifie(db)).toHaveLength(200);
    expect(listerJournalUnifie(db, { limite: 5000 })).toHaveLength(450);
    expect(listerJournalUnifie(db, { limite: 10 })).toHaveLength(10);
  });

  it("refuse une limite ou un curseur invalides", () => {
    expect(() => listerJournalUnifie(db, { limite: 0 })).toThrow(/limite/i);
    expect(() => listerJournalUnifie(db, { limite: "abc" as never })).toThrow(/limite/i);
    expect(() => listerJournalUnifie(db, { curseur: "n'importe quoi" })).toThrow(/curseur/i);
  });
});

// Spec 11.5 : « création de facture, encaissement » doivent figurer au journal. Chaque vente ajoute une facture et un encaissement : le
// périmètre par défaut reste la gestion (config, stock, abonnements, prix, SAV) pour que les gestes rares ne soient pas noyés ; un
// choix « ventes » montre les factures et les encaissements, « tout » les deux.
describe("listerJournalUnifie : ventes et encaissements (11.5)", () => {
  let idAbonneClient: number;
  beforeEach(() => {
    idAbonneClient = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555" }).returning().get().idAbonne;
  });

  function vente(partiel: Partial<typeof schema.facture.$inferInsert> = {}) {
    return db.insert(schema.facture).values({ siteId, idAbonne: idAbonneClient, creePar: userId, statut: "VALIDEE", montantTotal: 11900, montantTaxe: 1900, dateCreation: "2026-11-07 10:00:00", ...partiel }).returning().get();
  }
  function encaissement(idFacture: number, partiel: Partial<typeof schema.paiement.$inferInsert> = {}) {
    return db.insert(schema.paiement).values({ idFacture, mode: "CASH", montant: 11900, utilisateurId: userId, datePaiement: "2026-11-07 10:01:00", ...partiel }).returning().get();
  }

  it("par défaut, les ventes et encaissements n'encombrent pas le journal de gestion", () => {
    encaissement(vente().idFacture);
    mouvement("ACHAT", 5, "2026-11-07 09:00:00");

    expect(listerJournalUnifie(db).map((e) => e.tableCible)).toEqual(["stock_mouvement"]);
  });

  it("le périmètre « ventes » montre une facture et son encaissement, auteur compris", () => {
    const f = vente();
    const p = encaissement(f.idFacture, { mode: "VIREMENT", banque: "Afriland", referenceVirement: "VIR-001" });
    mouvement("ACHAT", 5, "2026-11-07 09:00:00");

    const journal = listerJournalUnifie(db, { perimetre: "ventes" });

    expect(journal.map((e) => e.tableCible)).toEqual(["paiement", "facture"]);
    expect(journal[0]).toMatchObject({ action: "CREATION", idCible: String(p.idPaiement), utilisateurNom: "Nga" });
    expect(JSON.parse(journal[0].valeurApres!)).toEqual({ idFacture: f.idFacture, mode: "VIREMENT", montant: 11900, banque: "Afriland", reference: "VIR-001" });
    expect(journal[1]).toMatchObject({ action: "CREATION", idCible: String(f.idFacture), utilisateurNom: "Nga" });
    expect(JSON.parse(journal[1].valeurApres!)).toEqual({ type: "Vente", statut: "VALIDEE", client: "Marie Ngo", totalTtc: 11900, tva: 1900 });
  });

  it("une facture sans client, un avoir et une vente en attente de paiement sont décrits tels quels", () => {
    vente({ idAbonne: null, statut: "BROUILLON", montantTotal: 2500, montantTaxe: 0, dateCreation: "2026-11-07 10:02:00" });
    const origine = vente({ dateCreation: "2026-11-07 10:03:00" });
    vente({ type: "AVOIR", factureOrigineId: origine.idFacture, montantTotal: -2500, montantTaxe: -399, dateCreation: "2026-11-07 10:04:00" });

    const [avoir, , enAttente] = listerJournalUnifie(db, { perimetre: "ventes" }).map((e) => JSON.parse(e.valeurApres!));

    expect(avoir).toMatchObject({ type: "Avoir", totalTtc: -2500, tva: -399 });
    expect(enAttente).toMatchObject({ client: "Sans client", statut: "BROUILLON" });
  });

  it("le périmètre « tout » mêle gestion et ventes, le plus récent en tête", () => {
    mouvement("ACHAT", 5, "2026-11-07 09:00:00");
    vente({ dateCreation: "2026-11-07 10:00:00" });

    expect(listerJournalUnifie(db, { perimetre: "tout" }).map((e) => e.tableCible)).toEqual(["facture", "stock_mouvement"]);
  });

  it("le périmètre « configuration » ne montre que le journal central", () => {
    db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "MODIFICATION", tableCible: "formule", idCible: "1", dateAction: "2026-11-07 08:00:00" }).run();
    mouvement("ACHAT", 5, "2026-11-07 09:00:00");

    expect(listerJournalUnifie(db, { perimetre: "configuration" }).map((e) => e.tableCible)).toEqual(["formule"]);
  });

  it("un filtre par table désigne la source quel que soit le périmètre : « facture » ou « paiement » suffisent", () => {
    const f = vente();
    encaissement(f.idFacture);

    expect(listerJournalUnifie(db, { tableCible: "facture" }).map((e) => e.tableCible)).toEqual(["facture"]);
    expect(listerJournalUnifie(db, { tableCible: "paiement" }).map((e) => e.tableCible)).toEqual(["paiement"]);
  });

  it("pagine sans doublon ni trou à travers les ventes et les encaissements", () => {
    for (let i = 0; i < 6; i++) {
      const f = vente({ dateCreation: "2026-11-07 10:00:00" });
      encaissement(f.idFacture, { datePaiement: "2026-11-07 10:00:00" });
    }

    const p1 = listerJournalUnifie(db, { perimetre: "ventes", limite: 5 });
    const p2 = listerJournalUnifie(db, { perimetre: "ventes", limite: 5, curseur: p1[4].curseur });
    const p3 = listerJournalUnifie(db, { perimetre: "ventes", limite: 5, curseur: p2[4].curseur });

    expect([p1.length, p2.length, p3.length]).toEqual([5, 5, 2]);
    expect(new Set([...p1, ...p2, ...p3].map((e) => e.curseur)).size).toBe(12);
  });

  it("refuse un périmètre inconnu", () => {
    expect(() => listerJournalUnifie(db, { perimetre: "n-importe-quoi" as never })).toThrow(/périmètre/i);
  });
});
