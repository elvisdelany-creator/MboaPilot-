import { describe, it, expect, beforeEach } from "vitest";
import type { SectionEtat } from "@mboapilot/shared";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerFixtureEtatVentes, type FixtureEtatVentes } from "../../test-utils/fixture-etat-ventes.js";
import { apercuExportComptable, exporterJournalVentesCsv } from "../export-comptable/export-comptable.service.js";
import { construireEtatVentes, espacerMilliers } from "./etat-ventes.service.js";

let db: Db;
let fx: FixtureEtatVentes;

const NOVEMBRE = { du: "2026-11-01", au: "2026-11-30" };
const MAINTENANT = new Date("2026-11-17T14:21:00.000Z");

beforeEach(() => {
  db = creerDbTest();
  fx = creerFixtureEtatVentes(db);
});

const section = (sections: SectionEtat[], titre: string) => {
  const trouvee = sections.find((s) => s.titre === titre);
  if (!trouvee) throw new Error(`section « ${titre} » absente : ${sections.map((s) => s.titre).join(", ")}`);
  return trouvee;
};

describe("construireEtatVentes : l'en-tête", () => {
  it("porte le titre, la période, la boutique et ses coordonnées, et la date de génération", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE, { maintenant: MAINTENANT });

    expect(etat.identifiant).toBe("etat-des-ventes");
    expect(etat.titre).toBe("État des ventes");
    expect(etat.periode).toEqual(NOVEMBRE);
    expect(etat.entete).toEqual({ nomBoutique: "Boutique Test", lignesContact: ["Douala — Akwa", "Boulevard de la Liberté", "Tél : 677 00 00 00"] });
    expect(etat.genereLe).toBe("2026-11-17T14:21:00.000Z");
    expect(etat.avertissements).toEqual([]);
  });

  it("refuse une période invalide, inversée ou trop longue, avec le message de l'export comptable", () => {
    expect(() => construireEtatVentes(db, fx.siteId, { du: "2026-11-30", au: "2026-11-01" })).toThrow(/inversée/);
    expect(() => construireEtatVentes(db, fx.siteId, { du: "2026-02-30", au: "2026-03-01" })).toThrow(/date de début/);
    expect(() => construireEtatVentes(db, fx.siteId, { du: "2025-01-01", au: "2026-11-30" })).toThrow(/trop longue/);
  });
});

describe("construireEtatVentes : récapitulatif par jour", () => {
  it("une ligne par jour avec activité, sur le jour de Douala, avoir en négatif, et le total", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Récapitulatif par jour");

    expect(s.colonnes.map((c) => c.libelle)).toEqual(["Jour", "Ventes", "Avoirs", "Total TTC", "dont TVA", "Total HT"]);
    expect(s.lignes).toEqual([
      ["2026-11-03", 1, 0, 11900, 1900, 10000],
      ["2026-11-04", 1, 0, 3500, 0, 3500], // F2 créée à 23 h 30 UTC le 03/11 : le 04/11 à Douala
      ["2026-11-05", 1, 0, 5000, 0, 5000],
      ["2026-11-06", 0, 1, -2500, 0, -2500],
      ["2026-11-07", 1, 0, 3000, 0, 3000],
      ["2026-11-09", 1, 0, 4000, 0, 4000],
    ]);
    expect(s.totaux).toEqual(["Total", 5, 1, 24900, 1900, 23000]);
  });

  it("ne reprend ni le brouillon, ni l'autre boutique, ni le mois suivant", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Récapitulatif par jour");

    expect(s.lignes.map((l) => l[0])).not.toContain("2026-11-08");
    expect(s.lignes.map((l) => l[0])).not.toContain("2026-12-02");
  });

  it("une période sans vente : aucune ligne, le message, des totaux à zéro", () => {
    const s = section(construireEtatVentes(db, fx.siteId, { du: "2026-01-01", au: "2026-01-31" }).sections, "Récapitulatif par jour");

    expect(s.lignes).toEqual([]);
    expect(s.messageVide).toBe("Aucune vente sur cette période");
    expect(s.totaux).toEqual(["Total", 0, 0, 0, 0, 0]);
  });
});

describe("construireEtatVentes : détail facture par facture", () => {
  it("une ligne par facture, la plus ancienne d'abord : date, n°, type, client, détail, TTC, encaissé, reste", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Détail facture par facture");
    const { f1, f2, f3, avoir, f4, f5 } = fx.factures;

    expect(s.colonnes.map((c) => c.libelle)).toEqual(["Date", "N°", "Type", "Client", "Détail", "Total TTC", "Encaissé à ce jour", "Reste à payer"]);
    expect(s.lignes).toEqual([
      ["2026-11-03", f1, "Vente", "Marie Ngo", "1 × EVASION + 1 × Câble HDMI", 11900, 11900, 0],
      ["2026-11-04", f2, "Vente", "Marie Ngo", "1 × 1 mois", 3500, 3500, 0], // acompte le 03/11 + solde le 01/12 : soldée aujourd'hui
      ["2026-11-05", f3, "Vente", "Marie Ngo", "2 × Câble HDMI", 5000, 2500, 0], // chèque 5 000 − remboursement 2 500
      ["2026-11-06", avoir, "Avoir", "Marie Ngo", "1 × Câble HDMI", -2500, 0, 0],
      ["2026-11-07", f4, "Vente", "Sans client", "1 × Main d'œuvre SAV", 3000, 3000, 0],
      ["2026-11-09", f5, "Vente", "Marie Ngo", "4 × Câble HDMI", 4000, 1000, 3000], // impayé partiel
    ]);
    expect(s.totaux).toEqual(["Total", "", "", "", "", 24900, 21900, 3000]);
  });

  it("une période sans vente : le message, et des totaux à zéro", () => {
    const s = section(construireEtatVentes(db, fx.siteId, { du: "2026-01-01", au: "2026-01-31" }).sections, "Détail facture par facture");

    expect(s.lignes).toEqual([]);
    expect(s.messageVide).toBe("Aucune vente sur cette période");
    expect(s.totaux).toEqual(["Total", "", "", "", "", 0, 0, 0]);
  });
});

describe("construireEtatVentes : garde-fou de volume", () => {
  it("au-delà de la limite, le détail est coupé, avec l'avertissement ; les autres sections et les totaux restent complets", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE, { limiteDetail: 2 });
    const detail = section(etat.sections, "Détail facture par facture");

    expect(detail.lignes.map((l) => l[1])).toEqual([fx.factures.f1, fx.factures.f2]);
    expect(detail.totaux).toBeUndefined(); // un total sur un détail coupé tromperait
    expect(etat.avertissements).toEqual(["Détail limité aux 2 premières factures : réduisez la période ou utilisez le CSV."]);
    expect(section(etat.sections, "Récapitulatif par jour").totaux).toEqual(["Total", 5, 1, 24900, 1900, 23000]);
    expect(section(etat.sections, "Totaux de la période").lignes[0]).toEqual(["Total TTC (net des avoirs)", 24900]);
  });

  it("n'avertit pas tant que la limite n'est pas dépassée, et dit combien de factures sont montrées quand elle l'est", () => {
    // 6 lignes de journal : limite atteinte, pas dépassée
    expect(construireEtatVentes(db, fx.siteId, NOVEMBRE, { limiteDetail: 6 }).avertissements).toEqual([]);
    expect(construireEtatVentes(db, fx.siteId, NOVEMBRE, { limiteDetail: 3 }).avertissements).toEqual(["Détail limité aux 3 premières factures : réduisez la période ou utilisez le CSV."]);
  });

  it("espacerMilliers écrit les milliers avec une espace simple (le PDF ne sait pas écrire l'espace insécable fine)", () => {
    expect([999, 1000, 1500, 5000, 1234567].map(espacerMilliers)).toEqual(["999", "1 000", "1 500", "5 000", "1 234 567"]);
  });

  it("la limite par défaut est de 5 000 factures", async () => {
    const { LIMITE_DETAIL_PAR_DEFAUT } = await import("./etat-ventes.service.js");
    expect(LIMITE_DETAIL_PAR_DEFAUT).toBe(5000);
  });
});

describe("construireEtatVentes : totaux de la période", () => {
  it("TTC net des avoirs, TVA, HT, encaissé sur la période et reste à payer des ventes de la période", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Totaux de la période");

    expect(s.lignes).toEqual([
      ["Total TTC (net des avoirs)", 24900],
      ["dont TVA", 1900],
      ["Total HT", 23000],
      ["Encaissé sur la période", 20400], // le solde de F2 (1 500 le 01/12) tombe en décembre
      ["Reste à payer des ventes de la période", 3000],
    ]);
  });

  it("la boutique B ne voit que ses propres ventes", () => {
    const s = section(construireEtatVentes(db, fx.autreSiteId, NOVEMBRE).sections, "Totaux de la période");

    expect(s.lignes[0]).toEqual(["Total TTC (net des avoirs)", 7777]);
  });

  it("les sections se suivent dans l'ordre de lecture, les totaux en dernier", () => {
    const titres = construireEtatVentes(db, fx.siteId, NOVEMBRE).sections.map((s) => s.titre);

    expect(titres).toEqual([
      "Récapitulatif par jour",
      "Répartition par famille d'activité",
      "Répartition par mode de paiement",
      "Détail facture par facture",
      "Totaux de la période",
    ]);
  });
});

describe("construireEtatVentes : répartition par famille d'activité", () => {
  it("le chiffre d'affaires de chaque famille (même résolution que le tableau de bord), le plus gros d'abord, avoir déduit", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Répartition par famille d'activité");

    expect(s.colonnes.map((c) => c.libelle)).toEqual(["Famille", "Chiffre d'affaires TTC"]);
    expect(s.lignes).toEqual([
      ["CANAL+", 10500],
      ["Produits & Services", 7900], // 1 400 + 5 000 − 2 500 (avoir) + 4 000
      ["Netflix", 3500],
      ["SAV", 3000],
    ]);
    expect(s.totaux).toEqual(["Total", 24900]);
  });

  it("une période sans vente : le message et un total à zéro", () => {
    const s = section(construireEtatVentes(db, fx.siteId, { du: "2026-01-01", au: "2026-01-31" }).sections, "Répartition par famille d'activité");

    expect(s.lignes).toEqual([]);
    expect(s.messageVide).toBe("Aucune vente sur cette période");
    expect(s.totaux).toEqual(["Total", 0]);
  });
});

describe("construireEtatVentes : répartition par mode de paiement", () => {
  it("les paiements dont la date tombe dans la période, par mode, remboursement déduit ; les quatre modes toujours présents", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Répartition par mode de paiement");

    expect(s.colonnes.map((c) => c.libelle)).toEqual(["Mode de paiement", "Montant"]);
    expect(s.lignes).toEqual([
      ["Espèces", 10400], // 11 900 − 2 500 (remboursement) + 1 000 ; le solde de F2 (1 500, 01/12) est hors période
      ["Chèque", 5000],
      ["Virement", 2000],
      ["Mobile Money", 3000],
    ]);
    expect(s.totaux).toEqual(["Total", 20400]);
  });

  it("une période sans encaissement : les quatre modes à zéro", () => {
    const s = section(construireEtatVentes(db, fx.siteId, { du: "2026-01-01", au: "2026-01-31" }).sections, "Répartition par mode de paiement");

    expect(s.lignes).toEqual([["Espèces", 0], ["Chèque", 0], ["Virement", 0], ["Mobile Money", 0]]);
    expect(s.totaux).toEqual(["Total", 0]);
  });

  it("n'ajoute pas les paiements d'une autre boutique", () => {
    const s = section(construireEtatVentes(db, fx.autreSiteId, NOVEMBRE).sections, "Répartition par mode de paiement");

    expect(s.totaux).toEqual(["Total", 7777]);
  });
});

describe("construireEtatVentes : les sections se recoupent", () => {
  const valeurs = (s: SectionEtat, colonne: number) => s.lignes.map((l) => l[colonne] as number);
  const total = (nombres: number[]) => nombres.reduce((a, b) => a + b, 0);

  it("1. la somme des jours est celle des totaux de la période (TTC, TVA, HT)", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE);
    const jours = section(etat.sections, "Récapitulatif par jour");
    const totaux = section(etat.sections, "Totaux de la période");

    expect([total(valeurs(jours, 3)), total(valeurs(jours, 4)), total(valeurs(jours, 5))]).toEqual([totaux.lignes[0][1], totaux.lignes[1][1], totaux.lignes[2][1]]);
  });

  it("2. la somme des familles est le total TTC net de l'état, avoirs compris", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE);

    expect(total(valeurs(section(etat.sections, "Répartition par famille d'activité"), 1))).toBe(section(etat.sections, "Totaux de la période").lignes[0][1]);
  });

  it("3. la somme des modes de paiement est l'encaissé de l'aperçu de l'export comptable pour la même période", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE);
    const apercu = apercuExportComptable(db, fx.siteId, NOVEMBRE);

    expect(total(valeurs(section(etat.sections, "Répartition par mode de paiement"), 1))).toBe(apercu.encaissements.total);
    expect(section(etat.sections, "Totaux de la période").lignes[3][1]).toBe(apercu.encaissements.total);
    expect(section(etat.sections, "Totaux de la période").lignes[0][1]).toBe(apercu.ventes.totalTtc);
    expect(section(etat.sections, "Totaux de la période").lignes[1][1]).toBe(apercu.ventes.totalTva);
  });

  it("4. le détail porte autant de lignes que le journal CSV des ventes, et son total TTC est celui de l'état", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE);
    const detail = section(etat.sections, "Détail facture par facture");

    expect(detail.lignes).toHaveLength(exporterJournalVentesCsv(db, fx.siteId, NOVEMBRE).nombre);
    expect(total(valeurs(detail, 5))).toBe(section(etat.sections, "Totaux de la période").lignes[0][1]);
  });
});
