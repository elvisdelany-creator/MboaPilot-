import { describe, it, expect } from "vitest";
import { calculerMontantTaxe } from "./taxe.js";

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
