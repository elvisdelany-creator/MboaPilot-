import { describe, it, expect } from "vitest";
import { peutAffecterEcran } from "./compte-partage-streaming.js";

describe("peutAffecterEcran (5.9)", () => {
  it("autorise l'affectation tant que le nombre d'écrans occupés est strictement inférieur au maximum", () => {
    expect(peutAffecterEcran(4, 3)).toBe(true);
    expect(peutAffecterEcran(4, 0)).toBe(true);
  });

  it("refuse l'affectation quand le compte est déjà à sa capacité maximale", () => {
    expect(peutAffecterEcran(4, 4)).toBe(false);
    expect(peutAffecterEcran(4, 5)).toBe(false);
  });

  it("refuse toujours pour un compte à capacité nulle ou négative (configuration invalide)", () => {
    expect(peutAffecterEcran(0, 0)).toBe(false);
  });
});
