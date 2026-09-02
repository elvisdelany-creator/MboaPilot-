import { describe, expect, it } from "vitest";
import { calculerMarge } from "./marge-article.js";

describe("calculerMarge (6.1 : champ valeur/pourcentage interchangeable)", () => {
  it("mode VALEUR : recalcule le pourcentage équivalent et le prix suggéré", () => {
    const resultat = calculerMarge({ margeType: "VALEUR", coutRevient: 8000, margeValeur: 2000, margePourcentage: null });

    expect(resultat.margeValeur).toBe(2000);
    expect(resultat.margePourcentage).toBe(2500); // 2000/8000 = 25.00% -> 2500 centièmes
    expect(resultat.prixSuggere).toBe(10000);
  });

  it("mode POURCENTAGE : recalcule le montant équivalent et le prix suggéré", () => {
    const resultat = calculerMarge({ margeType: "POURCENTAGE", coutRevient: 8000, margeValeur: null, margePourcentage: 1500 }); // 15.00%

    expect(resultat.margeValeur).toBe(1200);
    expect(resultat.margePourcentage).toBe(1500);
    expect(resultat.prixSuggere).toBe(9200);
  });

  it("un coût de revient nul en mode POURCENTAGE ne divise jamais par zéro", () => {
    const resultat = calculerMarge({ margeType: "VALEUR", coutRevient: 0, margeValeur: 500, margePourcentage: null });

    expect(resultat.margePourcentage).toBe(0);
    expect(resultat.prixSuggere).toBe(500);
  });

  it("des champs absents sont traités comme zéro plutôt que de planter", () => {
    const resultat = calculerMarge({ margeType: "VALEUR", coutRevient: 5000, margeValeur: null, margePourcentage: null });

    expect(resultat.margeValeur).toBe(0);
    expect(resultat.prixSuggere).toBe(5000);
  });
});
