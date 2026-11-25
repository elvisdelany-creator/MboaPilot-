import { describe, it, expect } from "vitest";
import { montantAvoirLigne } from "./montant-avoir.js";

// une ligne remisée ne se divise pas toujours : 3 articles facturés 7 499
const ligne = { prixApplique: 7499, quantite: 3 };

describe("montantAvoirLigne (6.4)", () => {
  it("créditer toute la ligne reprend exactement ce qui a été facturé", () => {
    expect(montantAvoirLigne({ ...ligne, montantDejaCredite: 0, quantiteDejaCreditee: 0 }, 3)).toBe(7499);
  });

  it("article par article, la somme des avoirs retombe sur le montant de la ligne", () => {
    let montant = 0;
    const montants: number[] = [];
    for (let deja = 0; deja < 3; deja++) {
      const m = montantAvoirLigne({ ...ligne, montantDejaCredite: montant, quantiteDejaCreditee: deja }, 1);
      montants.push(m);
      montant += m;
    }
    expect(montants).toEqual([2500, 2499, 2500]);
    expect(montant).toBe(7499);
  });

  it("une ligne qui se divise juste ne change pas", () => {
    expect(montantAvoirLigne({ prixApplique: 12000, quantite: 4, montantDejaCredite: 0, quantiteDejaCreditee: 0 }, 3)).toBe(9000);
  });

  // des avoirs émis avant la correction ont pu reprendre un peu trop : le dernier ne devient jamais négatif
  it("ne devient jamais négatif quand les avoirs précédents ont déjà trop repris", () => {
    expect(montantAvoirLigne({ prixApplique: 2, quantite: 3, montantDejaCredite: 3, quantiteDejaCreditee: 2 }, 1)).toBe(0);
  });
});
