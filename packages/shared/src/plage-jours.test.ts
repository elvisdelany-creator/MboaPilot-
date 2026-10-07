import { describe, expect, it } from "vitest";
import { decalerJour, genererPlageJours } from "./plage-jours.js";

describe("genererPlageJours (9.3 : axe temporel de la courbe d'évolution du CA)", () => {
  it("renvoie N jours consécutifs se terminant à aujourd'hui, ordre croissant", () => {
    expect(genererPlageJours("2026-01-10", 5)).toEqual(["2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10"]);
  });

  it("un seul jour renvoie uniquement aujourd'hui", () => {
    expect(genererPlageJours("2026-01-10", 1)).toEqual(["2026-01-10"]);
  });

  it("traverse correctement un changement de mois et d'année", () => {
    expect(genererPlageJours("2026-01-02", 4)).toEqual(["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  });
});

describe("decalerJour (bornes de plage pour les requêtes SQL)", () => {
  it("décale vers l'avenir et vers le passé, à travers mois et années", () => {
    expect(decalerJour("2026-01-31", 1)).toBe("2026-02-01");
    expect(decalerJour("2026-01-01", -1)).toBe("2025-12-31");
    expect(decalerJour("2026-03-10", 0)).toBe("2026-03-10");
  });
});
