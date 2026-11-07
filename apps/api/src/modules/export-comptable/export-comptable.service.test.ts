import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { apercuExportComptable, exporterJournalEncaissementsCsv, exporterJournalVentesCsv, verifierPeriodeExport } from "./export-comptable.service.js";

let db: Db;
let siteId: number;
let autreSiteId: number;
let userId: number;
let idAbonne: number;
let idProduit: number;
let idFormule: number;
let numeroAbonnement: number;

// Le cahier des charges promet un « export comptable » (offre Pro) : sans lui, le comptable ressaisit à la main ses ventes et ses
// encaissements du mois. Deux journaux en CSV pour Excel français (« ; »), sur le jour de Douala, avec la TVA figée à la vente.
beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555" }).returning().get().idAbonne;
  idProduit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500 }).returning().get().idProduit;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  idFormule = db.insert(schema.formule).values({ idFamille: famille, libelle: "EVASION", prix: 10500, rang: 3 }).returning().get().idFormule;
  numeroAbonnement = db.insert(schema.abonnement).values({ idAbonne, idFormule, siteId, dateDebut: "2026-11-01", dateFin: "2026-11-30", creePar: userId }).returning().get().numeroAbonnement;
});

function facture(partiel: Partial<typeof schema.facture.$inferInsert> = {}) {
  return db.insert(schema.facture).values({ siteId, idAbonne, creePar: userId, statut: "VALIDEE", montantTotal: 11900, montantTaxe: 1900, dateCreation: "2026-11-03 09:00:00", ...partiel }).returning().get();
}

function paiement(idFacture: number, partiel: Partial<typeof schema.paiement.$inferInsert> = {}) {
  return db.insert(schema.paiement).values({ idFacture, mode: "CASH", montant: 11900, utilisateurId: userId, datePaiement: "2026-11-03 09:05:00", ...partiel }).returning().get();
}

const lignes = (csv: string) => csv.split("\r\n").map((l) => l.split(";"));
const PERIODE = { du: "2026-11-01", au: "2026-11-30" };

describe("exporterJournalVentesCsv", () => {
  it("écrit un en-tête puis une ligne par facture validée : client, détail, TTC, TVA, HT, encaissé, reste dû", () => {
    const f = facture();
    db.insert(schema.ligneVente).values({ idFacture: f.idFacture, numeroAbonnement, prixApplique: 10500 }).run();
    db.insert(schema.ligneVente).values({ idFacture: f.idFacture, idProduit, quantite: 2, prixApplique: 700 }).run();
    paiement(f.idFacture, { montant: 10000 });

    const { csv, nombre } = exporterJournalVentesCsv(db, siteId, PERIODE);

    expect(nombre).toBe(1);
    expect(lignes(csv)).toEqual([
      ["Date", "N° facture", "Type", "Facture d'origine", "N° client", "Client", "Détail", "Total TTC", "dont TVA", "Total HT", "Encaissé", "Reste à payer"],
      ["03/11/2026", String(f.idFacture), "Vente", "", String(idAbonne), "Marie Ngo", "1 × EVASION + 2 × Câble HDMI", "11900", "1900", "10000", "10000", "1900"],
    ]);
  });

  it("sépare les champs par « ; » (Excel français) et les lignes par un retour chariot", () => {
    facture();
    const { csv } = exporterJournalVentesCsv(db, siteId, PERIODE);

    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv.split("\r\n")[0].split(";")).toHaveLength(12);
  });

  it("une vente sans client enregistré porte la mention « Sans client »", () => {
    facture({ idAbonne: null });

    const [, ligne] = lignes(exporterJournalVentesCsv(db, siteId, PERIODE).csv);

    expect(ligne[4]).toBe("");
    expect(ligne[5]).toBe("Sans client");
  });

  it("ne reprend ni les ventes en attente (brouillon), ni un autre site, ni une autre période", () => {
    facture({ statut: "BROUILLON" });
    facture({ siteId: autreSiteId, idAbonne: null });
    facture({ dateCreation: "2026-10-15 09:00:00" });
    facture({ dateCreation: "2026-12-02 09:00:00" });
    const dedans = facture({ dateCreation: "2026-11-20 09:00:00" });

    const { csv, nombre } = exporterJournalVentesCsv(db, siteId, PERIODE);

    expect(nombre).toBe(1);
    expect(lignes(csv)[1][1]).toBe(String(dedans.idFacture));
  });

  // une vente à 23h30 UTC le 31/10 est une vente de 00h30 le 1er novembre à Douala (UTC+1) : le chiffre d'affaires du tableau de bord
  // la compte en novembre ; l'export doit faire de même, sinon le comptable ne retrouve pas le total de l'écran
  it("compte le jour à Douala (UTC+1) : 23h30 UTC le 31/10 est le 1er novembre", () => {
    facture({ dateCreation: "2026-10-31 23:30:00" });
    facture({ dateCreation: "2026-11-30 23:30:00" });

    const novembre = exporterJournalVentesCsv(db, siteId, { du: "2026-11-01", au: "2026-11-30" });
    const octobre = exporterJournalVentesCsv(db, siteId, { du: "2026-10-01", au: "2026-10-31" });

    expect(novembre.nombre).toBe(1);
    expect(lignes(novembre.csv)[1][0]).toBe("01/11/2026");
    expect(octobre.nombre).toBe(0);
  });

  it("inclut le dernier jour de la période en entier", () => {
    facture({ dateCreation: "2026-11-29 22:59:59" });
    facture({ dateCreation: "2026-11-30 22:59:59" });

    expect(exporterJournalVentesCsv(db, siteId, { du: "2026-11-30", au: "2026-11-30" }).nombre).toBe(1);
  });

  // le remboursement d'un avoir s'enregistre sur la facture d'ORIGINE (constaté en test grandeur nature) : c'est elle qui l'a encaissée
  it("montre un avoir en négatif, avec la facture qu'il corrige ; il n'est jamais une dette", () => {
    const origine = facture();
    paiement(origine.idFacture, { montant: 11900 });
    const avoir = facture({ type: "AVOIR", factureOrigineId: origine.idFacture, montantTotal: -2500, montantTaxe: -399, dateCreation: "2026-11-05 10:00:00" });
    paiement(origine.idFacture, { montant: -2500, datePaiement: "2026-11-05 10:01:00" });

    const ligne = lignes(exporterJournalVentesCsv(db, siteId, PERIODE).csv).find((l) => l[1] === String(avoir.idFacture))!;

    expect(ligne.slice(2, 4)).toEqual(["Avoir", String(origine.idFacture)]);
    expect(ligne.slice(7)).toEqual(["-2500", "-399", "-2101", "0", "0"]);
  });

  // « Reste à payer » suit la règle de l'application (solde = total + avoirs − encaissé) : une vente remboursée par avoir ne montre pas
  // une dette que personne ne doit — constaté en test grandeur nature (vente de 10 000 payée puis intégralement remboursée : « reste 10 000 »)
  it("une vente créditée par un avoir et remboursée n'est pas en reste", () => {
    const origine = facture();
    paiement(origine.idFacture, { montant: 11900 });
    facture({ type: "AVOIR", factureOrigineId: origine.idFacture, montantTotal: -2500, montantTaxe: -399, dateCreation: "2026-11-05 10:00:00" });
    paiement(origine.idFacture, { montant: -2500, datePaiement: "2026-11-05 10:01:00" });

    const ligne = lignes(exporterJournalVentesCsv(db, siteId, PERIODE).csv).find((l) => l[1] === String(origine.idFacture))!;

    expect(ligne.slice(7)).toEqual(["11900", "1900", "10000", "9400", "0"]);
  });

  it("un avoir émis le mois suivant corrige quand même le reste à payer de la vente exportée", () => {
    const origine = facture();
    facture({ type: "AVOIR", factureOrigineId: origine.idFacture, montantTotal: -11900, montantTaxe: -1900, dateCreation: "2026-12-04 10:00:00" });

    const ligne = lignes(exporterJournalVentesCsv(db, siteId, PERIODE).csv).find((l) => l[1] === String(origine.idFacture))!;

    expect(ligne[11]).toBe("0");
  });

  it("un avoir non remboursé laisse un crédit client : le reste à payer de la vente est négatif", () => {
    const origine = facture();
    paiement(origine.idFacture, { montant: 11900 });
    facture({ type: "AVOIR", factureOrigineId: origine.idFacture, montantTotal: -2500, montantTaxe: -399, dateCreation: "2026-11-05 10:00:00" });

    const ligne = lignes(exporterJournalVentesCsv(db, siteId, PERIODE).csv).find((l) => l[1] === String(origine.idFacture))!;

    expect(ligne[11]).toBe("-2500");
  });

  it("neutralise un nom de client qui commencerait comme une formule de tableur", () => {
    const piege = db.insert(schema.abonne).values({ siteId, nom: "=CMD()", prenom: "+Mal", telephone: "699111222" }).returning().get().idAbonne;
    facture({ idAbonne: piege });

    const [, ligne] = lignes(exporterJournalVentesCsv(db, siteId, PERIODE).csv);

    expect(ligne[5].startsWith("'")).toBe(true);
  });

  it("met le plus ancien en premier : le journal se lit dans l'ordre du temps", () => {
    const tard = facture({ dateCreation: "2026-11-20 09:00:00" });
    const tot = facture({ dateCreation: "2026-11-02 09:00:00" });

    const ids = lignes(exporterJournalVentesCsv(db, siteId, PERIODE).csv).slice(1).map((l) => Number(l[1]));

    expect(ids).toEqual([tot.idFacture, tard.idFacture]);
  });

  it("nomme l'option d'un abonnement et le kit vendu", () => {
    const famille = db.select().from(schema.familleAbonnement).get()!.idFamille;
    const idOption = db.insert(schema.optionComplement).values({ libelle: "Option English Plus", prix: 5000 }).returning().get().idOption;
    const idKit = db.insert(schema.kit).values({ idFamille: famille, libelle: "KIT GLOBALZ", reglePrix: "PRIX_FIXE", prixFixe: 30000 }).returning().get().idKit;
    const f = facture();
    db.insert(schema.ligneVente).values({ idFacture: f.idFacture, numeroAbonnement, prixApplique: 10500 }).run();
    db.insert(schema.ligneVente).values({ idFacture: f.idFacture, idKit, prixApplique: 30000 }).run();
    db.insert(schema.ligneVente).values({ idFacture: f.idFacture, idOption, numeroAbonnement, prixApplique: 5000 }).run();

    const [, ligne] = lignes(exporterJournalVentesCsv(db, siteId, PERIODE).csv);

    expect(ligne[6]).toBe("1 × EVASION + 1 × KIT GLOBALZ + 1 × Option English Plus");
  });
});

describe("exporterJournalEncaissementsCsv", () => {
  it("écrit un paiement par ligne, avec de quoi le retrouver sur le relevé : mode, banque, référence, rapprochement, auteur", () => {
    const f = facture();
    const p = paiement(f.idFacture, { mode: "VIREMENT", montant: 11900, banque: "Afriland", referenceVirement: "VIR-001", statutRapprochement: "EN_ATTENTE", datePaiement: "2026-11-03 09:05:00" });

    const { csv, nombre } = exporterJournalEncaissementsCsv(db, siteId, PERIODE);

    expect(nombre).toBe(1);
    expect(lignes(csv)).toEqual([
      ["Date", "Heure", "N° paiement", "N° facture", "Client", "Mode", "Montant", "Banque", "Référence", "Rapprochement", "Encaissé par"],
      ["03/11/2026", "10:05", String(p.idPaiement), String(f.idFacture), "Marie Ngo", "Virement", "11900", "Afriland", "VIR-001", "En attente", "Paul Nga"],
    ]);
  });

  it.each([
    ["CASH", {}, "Espèces", "", ""],
    ["CHEQUE", { banque: "UBA", numeroCheque: "0042" }, "Chèque", "UBA", "0042"],
    ["MOBILE_MONEY", { referenceTransaction: "MM-777" }, "Mobile Money", "", "MM-777"],
  ] as const)("%s : mode en français et référence adaptée", (mode, extra, libelleMode, banque, reference) => {
    paiement(facture().idFacture, { mode, ...extra });

    const [, ligne] = lignes(exporterJournalEncaissementsCsv(db, siteId, PERIODE).csv);

    expect(ligne.slice(5, 10)).toEqual([libelleMode, ligne[6], banque, reference, "—"].map((v, i) => (i === 1 ? "11900" : v)));
  });

  it("montre un remboursement en négatif", () => {
    paiement(facture().idFacture, { montant: -2500 });

    const [, ligne] = lignes(exporterJournalEncaissementsCsv(db, siteId, PERIODE).csv);

    expect(ligne[6]).toBe("-2500");
  });

  it("filtre sur la date du paiement, à Douala, et sur le site : un acompte et son solde tombent chacun dans leur mois", () => {
    const f = facture({ dateCreation: "2026-10-30 09:00:00" });
    paiement(f.idFacture, { montant: 5000, datePaiement: "2026-10-30 09:05:00" });
    paiement(f.idFacture, { montant: 6900, datePaiement: "2026-11-02 09:05:00" });
    paiement(facture({ siteId: autreSiteId, idAbonne: null }).idFacture, { datePaiement: "2026-11-02 09:05:00" });
    paiement(f.idFacture, { montant: 1, datePaiement: "2026-10-31 23:30:00" });

    const novembre = exporterJournalEncaissementsCsv(db, siteId, PERIODE);

    expect(novembre.nombre).toBe(2);
    expect(lignes(novembre.csv).slice(1).map((l) => l[6])).toEqual(["1", "6900"]);
  });

  it("garde un paiement dont la vente n'a pas de client", () => {
    paiement(facture({ idAbonne: null }).idFacture);

    expect(lignes(exporterJournalEncaissementsCsv(db, siteId, PERIODE).csv)[1][4]).toBe("Sans client");
  });
});

describe("apercuExportComptable", () => {
  it("annonce les nombres et les totaux, identiques au contenu des deux fichiers (avoirs retranchés)", () => {
    const origine = facture();
    paiement(origine.idFacture, { montant: 11900 });
    const avoir = facture({ type: "AVOIR", factureOrigineId: origine.idFacture, montantTotal: -2500, montantTaxe: -399, dateCreation: "2026-11-05 10:00:00" });
    paiement(avoir.idFacture, { mode: "CASH", montant: -2500, datePaiement: "2026-11-05 10:01:00" });

    expect(apercuExportComptable(db, siteId, PERIODE)).toEqual({
      ventes: { nombre: 2, totalTtc: 9400, totalTva: 1501 },
      encaissements: { nombre: 2, total: 9400 },
    });
  });

  it("ne compte rien sur une période sans activité", () => {
    expect(apercuExportComptable(db, siteId, PERIODE)).toEqual({ ventes: { nombre: 0, totalTtc: 0, totalTva: 0 }, encaissements: { nombre: 0, total: 0 } });
  });
});

describe("verifierPeriodeExport", () => {
  it("accepte une période valide, d'un seul jour ou de plus d'un an moins un jour", () => {
    expect(() => verifierPeriodeExport({ du: "2026-11-01", au: "2026-11-01" })).not.toThrow();
    expect(() => verifierPeriodeExport({ du: "2025-11-02", au: "2026-11-01" })).not.toThrow();
  });

  it.each([
    ["début absent", { du: "", au: "2026-11-30" }],
    ["fin absente", { du: "2026-11-01", au: undefined }],
    ["début mal formé", { du: "01/11/2026", au: "2026-11-30" }],
    ["jour impossible", { du: "2026-02-30", au: "2026-03-05" }],
    ["fin avant le début", { du: "2026-11-30", au: "2026-11-01" }],
    ["période de plus de 366 jours", { du: "2025-01-01", au: "2026-11-01" }],
  ])("refuse une période invalide : %s", (_nom, periode) => {
    expect(() => verifierPeriodeExport(periode as never)).toThrow(/période|date/i);
  });

  it("les exports refusent une période invalide avant de toucher à la base", () => {
    expect(() => exporterJournalVentesCsv(db, siteId, { du: "2026-11-30", au: "2026-11-01" })).toThrow(/période/i);
    expect(() => exporterJournalEncaissementsCsv(db, siteId, { du: "x", au: "y" })).toThrow(/date|période/i);
    expect(() => apercuExportComptable(db, siteId, { du: "2026-11-30", au: "2026-11-01" })).toThrow(/période/i);
  });
});
