import { describe, it, expect } from "vitest";
import { soldeFacture, soldeTotalDu, type FactureSolde, type PaiementSolde } from "./solde-facture.js";

// Constaté en test grandeur nature : « Solde total dû » additionnait le solde de chaque facture, avoirs
// compris. Or l'avoir est déjà déduit de sa facture d'origine : il comptait deux fois. Un client qui
// devait 6 000 FCFA sur une facture, et dont une autre facture de 5 000 FCFA avait été créditée par un
// avoir, n'affichait plus aucun solde dû (6 000 − 5 000 − 5 000 − 5 000 < 0).
const vente = (idFacture: number, montantTotal: number): FactureSolde => ({ idFacture, type: "VENTE", montantTotal, factureOrigineId: null });
const avoir = (idFacture: number, factureOrigineId: number, montantTotal: number): FactureSolde => ({ idFacture, type: "AVOIR", montantTotal, factureOrigineId });
const paiement = (idFacture: number, montant: number): PaiementSolde => ({ idFacture, montant });

describe("soldeFacture", () => {
  it("vaut le total moins les paiements", () => {
    const factures = [vente(1, 10000)];

    expect(soldeFacture(factures[0], factures, [paiement(1, 4000)])).toBe(6000);
  });

  it("déduit les avoirs émis sur la facture", () => {
    const factures = [vente(1, 10000), avoir(2, 1, -3000)];

    expect(soldeFacture(factures[0], factures, [])).toBe(7000);
  });

  it("devient négatif quand une facture payée est entièrement créditée (remboursement dû au client)", () => {
    const factures = [vente(1, 5000), avoir(2, 1, -5000)];

    expect(soldeFacture(factures[0], factures, [paiement(1, 5000)])).toBe(-5000);
  });
});

describe("soldeTotalDu", () => {
  it("additionne les soldes restant dus des factures de vente", () => {
    const factures = [vente(1, 10000), vente(2, 4000)];

    expect(soldeTotalDu(factures, [paiement(1, 4000), paiement(2, 1000)])).toBe(9000);
  });

  it("ne compte pas une facture d'avoir une seconde fois", () => {
    const factures = [vente(1, 5000), vente(2, 10000), avoir(3, 1, -5000)];
    const paiements = [paiement(1, 5000), paiement(2, 4000)];

    expect(soldeTotalDu(factures, paiements)).toBe(6000);
  });

  it("ne compense pas un impayé par le remboursement dû sur une autre facture", () => {
    const factures = [vente(1, 5000), avoir(2, 1, -5000), vente(3, 3000)];

    expect(soldeTotalDu(factures, [paiement(1, 5000)])).toBe(3000);
  });

  it("tient compte d'un avoir partiel sur une facture impayée", () => {
    const factures = [vente(1, 10000), avoir(2, 1, -3000)];

    expect(soldeTotalDu(factures, [])).toBe(7000);
  });

  it("vaut 0 sans facture, ou quand tout est soldé", () => {
    expect(soldeTotalDu([], [])).toBe(0);
    expect(soldeTotalDu([vente(1, 5000)], [paiement(1, 5000)])).toBe(0);
  });
});
