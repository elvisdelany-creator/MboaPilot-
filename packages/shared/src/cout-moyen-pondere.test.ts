import { describe, expect, it } from "vitest";
import { calculerCoutMoyenPondere } from "./cout-moyen-pondere.js";

describe("calculerCoutMoyenPondere (5.2 : réception d'achat)", () => {
  it("pondère le nouveau coût par les quantités respectives du stock existant et de l'achat", () => {
    // 10 unités à 1000 + 10 unités à 2000 -> moyenne 1500
    expect(calculerCoutMoyenPondere(10, 1000, 10, 2000)).toBe(1500);
  });

  it("arrondit à l'entier le plus proche (FCFA, pas de centimes)", () => {
    // (5*1000 + 3*1200) / 8 = 1075
    expect(calculerCoutMoyenPondere(5, 1000, 3, 1200)).toBe(1075);
  });

  it("un stock initial vide adopte directement le coût unitaire d'achat", () => {
    expect(calculerCoutMoyenPondere(0, 0, 20, 3500)).toBe(3500);
  });

  it("une réception sur un stock déjà en place déplace la moyenne vers le nouveau coût", () => {
    expect(calculerCoutMoyenPondere(100, 500, 10, 1000)).toBe(545);
  });
});
