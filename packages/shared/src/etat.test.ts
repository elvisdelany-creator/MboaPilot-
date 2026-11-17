import { describe, it, expect } from "vitest";
import { dateHeureDouala, etatVersCsv, formaterValeurEtat, libellePeriodeEtat, nomFichierEtat, type EtatImprimable } from "./etat.js";

// Intl.NumberFormat("fr-FR") sépare les milliers par une espace insécable fine : les tests la ramènent à une espace simple
const normaliser = (texte: string) => texte.replace(/[\u00a0\u202f]/g, " ");

function etatExemple(surcharges: Partial<EtatImprimable> = {}): EtatImprimable {
  return {
    identifiant: "etat-des-ventes",
    titre: "État des ventes",
    periode: { du: "2026-11-01", au: "2026-11-17" },
    entete: { nomBoutique: "Boutique Démo", lignesContact: ["Tél : 677 00 00 00"] },
    genereLe: "2026-11-17T14:21:00.000Z",
    sections: [
      {
        titre: "Par jour",
        colonnes: [
          { cle: "jour", libelle: "Jour", type: "date", alignement: "gauche" },
          { cle: "ttc", libelle: "Total TTC", type: "fcfa", alignement: "droite" },
        ],
        lignes: [
          ["2026-11-16", 12500],
          ["2026-11-17", 3000],
        ],
        totaux: ["Total", 15500],
      },
      {
        titre: "Par famille",
        colonnes: [
          { cle: "famille", libelle: "Famille", type: "texte", alignement: "gauche" },
          { cle: "montant", libelle: "Montant", type: "fcfa", alignement: "droite" },
        ],
        lignes: [],
        messageVide: "Aucune vente sur cette période",
      },
    ],
    avertissements: [],
    ...surcharges,
  };
}

describe("formaterValeurEtat", () => {
  it("regroupe les milliers des entiers et des montants, négatifs compris", () => {
    expect(normaliser(formaterValeurEtat(12500, "fcfa"))).toBe("12 500");
    expect(normaliser(formaterValeurEtat(1234567, "entier"))).toBe("1 234 567");
    expect(normaliser(formaterValeurEtat(-2500, "fcfa"))).toBe("-2 500");
    expect(formaterValeurEtat(0, "fcfa")).toBe("0");
  });

  it("n'emploie jamais le vrai signe moins (U+2212), absent du jeu de caractères du PDF", () => {
    expect(formaterValeurEtat(-2500, "fcfa")).not.toContain("\u2212");
  });

  it("met une date AAAA-MM-JJ en JJ/MM/AAAA et laisse tout autre texte tel quel", () => {
    expect(formaterValeurEtat("2026-11-17", "date")).toBe("17/11/2026");
    expect(formaterValeurEtat("Total", "date")).toBe("Total");
  });

  it("laisse un texte tel quel, et ne touche pas à un texte placé dans une colonne de nombres (ligne de totaux)", () => {
    expect(formaterValeurEtat("Marie Ngo", "texte")).toBe("Marie Ngo");
    expect(formaterValeurEtat("Total", "fcfa")).toBe("Total");
    expect(formaterValeurEtat("", "entier")).toBe("");
    expect(formaterValeurEtat(5, "texte")).toBe("5");
  });
});

describe("libellePeriodeEtat et dateHeureDouala", () => {
  it("dit « du … au … » pour une période, « le … » pour un seul jour", () => {
    expect(libellePeriodeEtat({ du: "2026-11-01", au: "2026-11-17" })).toBe("du 01/11/2026 au 17/11/2026");
    expect(libellePeriodeEtat({ du: "2026-11-17", au: "2026-11-17" })).toBe("le 17/11/2026");
  });

  it("donne la date et l'heure de Douala (UTC+1), y compris au passage de minuit", () => {
    expect(dateHeureDouala("2026-11-17T14:21:00.000Z")).toBe("17/11/2026 15:21");
    expect(dateHeureDouala("2026-11-16T23:30:00.000Z")).toBe("17/11/2026 00:30");
  });
});

describe("nomFichierEtat", () => {
  it("compose le nom à partir de l'identifiant de l'état et de la période", () => {
    expect(nomFichierEtat(etatExemple(), "pdf")).toBe("etat-des-ventes-2026-11-01-au-2026-11-17.pdf");
    expect(nomFichierEtat(etatExemple(), "csv")).toBe("etat-des-ventes-2026-11-01-au-2026-11-17.csv");
  });
});

describe("etatVersCsv", () => {
  it("écrit le titre, la période, la boutique, la date de génération, puis chaque section séparée d'une ligne vide, avec ses totaux", () => {
    expect(etatVersCsv(etatExemple()).split("\r\n")).toEqual([
      "État des ventes",
      "Période;du 01/11/2026 au 17/11/2026",
      "Boutique;Boutique Démo",
      "Généré le;17/11/2026 15:21",
      "",
      "Par jour",
      "Jour;Total TTC",
      "16/11/2026;12500",
      "17/11/2026;3000",
      "Total;15500",
      "",
      "Par famille",
      "Famille;Montant",
      "Aucune vente sur cette période",
    ]);
  });

  it("écrit les montants en nombres bruts (pas d'espaces dans les milliers : Excel les lit comme des nombres)", () => {
    expect(etatVersCsv(etatExemple())).toContain("16/11/2026;12500");
  });

  it("reprend les avertissements sous l'en-tête", () => {
    const csv = etatVersCsv(etatExemple({ avertissements: ["Détail limité aux 2 premières factures : réduisez la période ou utilisez le CSV."] })).split("\r\n");

    expect(csv[4]).toBe("Avertissement;Détail limité aux 2 premières factures : réduisez la période ou utilisez le CSV.");
  });

  it("neutralise une cellule qui commence par = + - @ (formule de tableur) et protège les « ; » du texte", () => {
    const etat = etatExemple({
      sections: [
        {
          titre: "Clients",
          colonnes: [{ cle: "client", libelle: "Client", type: "texte", alignement: "gauche" }],
          lignes: [["=HYPERLINK(\"http://pirate.example\")"], ["Ngo; Marie"]],
        },
      ],
    });

    const lignes = etatVersCsv(etat).split("\r\n");

    expect(lignes).toContain("\"'=HYPERLINK(\"\"http://pirate.example\"\")\"");
    expect(lignes).toContain("\"Ngo; Marie\"");
  });

  it("une section sans ligne ni message écrit « Aucune donnée »", () => {
    const etat = etatExemple({ sections: [{ titre: "Vide", colonnes: [{ cle: "a", libelle: "A", type: "texte", alignement: "gauche" }], lignes: [] }] });

    expect(etatVersCsv(etat)).toContain("Aucune donnée");
  });
});
