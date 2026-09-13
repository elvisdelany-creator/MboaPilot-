import { describe, it, expect } from "vitest";
import { calculerMontantTaxe, extraireTaxeDuTTC } from "./taxe.js";

describe("calculerMontantTaxe (6.1, 8.8)", () => {
  it("calcule le montant de taxe à partir d'un taux en centièmes de % (ex. 1925 = 19,25 %)", () => {
    expect(calculerMontantTaxe(10000, 1925)).toBe(1925);
  });

  it("renvoie 0 quand aucun taux n'est configuré (taxe non applicable)", () => {
    expect(calculerMontantTaxe(10000, null)).toBe(0);
  });

  it("arrondit au franc le plus proche", () => {
    expect(calculerMontantTaxe(3500, 1925)).toBe(674); // 3500 * 0.1925 = 673.75
  });
});

// 3.2.3 : "porte le total, la TVA/taxes le cas échéant" — le prix catalogue
// saisi est réputé TTC ; extrait la part de taxe incluse dans un montant,
// pour l'historiser sur la facture au moment de sa création (jamais recalculé
// après coup avec un taux qui aurait changé depuis).
describe("extraireTaxeDuTTC (3.2.3, 6.1, 8.8)", () => {
  it("extrait le montant de taxe inclus dans un total TTC", () => {
    expect(extraireTaxeDuTTC(12000, 2000)).toBe(2000); // 20 % de 10000 HT
  });

  it("renvoie 0 quand aucun taux n'est configuré", () => {
    expect(extraireTaxeDuTTC(10000, null)).toBe(0);
  });

  it("préserve le signe sur un montant négatif (avoir)", () => {
    expect(extraireTaxeDuTTC(-12000, 2000)).toBe(-2000);
  });
});
