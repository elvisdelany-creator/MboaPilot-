import { describe, it, expect } from "vitest";
import { plafondRemiseCaissier } from "./plafond-remise.js";

// 6.4, 2.5.1 : un caissier ne remise pas au-delà d'un pourcentage du prix de la ligne
describe("plafondRemiseCaissier", () => {
  it("20 % de 10 000 FCFA : 2 000", () => {
    expect(plafondRemiseCaissier(10000, 20)).toBe(2000);
  });

  it("arrondit vers le bas : une remise est un montant entier de FCFA qui ne dépasse jamais le pourcentage", () => {
    expect(plafondRemiseCaissier(999, 20)).toBe(199); // 199,8
    expect(plafondRemiseCaissier(2500, 15)).toBe(375);
    expect(plafondRemiseCaissier(7, 10)).toBe(0); // 0,7
  });

  it("0 % : aucune remise ; 100 % : le prix entier", () => {
    expect(plafondRemiseCaissier(15000, 0)).toBe(0);
    expect(plafondRemiseCaissier(15000, 100)).toBe(15000);
  });

  it("un prix nul donne un plafond nul", () => {
    expect(plafondRemiseCaissier(0, 20)).toBe(0);
  });

  it("n'est jamais négatif ni supérieur au prix, même avec un pourcentage aberrant", () => {
    expect(plafondRemiseCaissier(10000, -5)).toBe(0);
    expect(plafondRemiseCaissier(10000, 250)).toBe(10000);
  });
});
