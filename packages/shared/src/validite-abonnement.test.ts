import { describe, it, expect } from "vitest";
import { calculerDateFin } from "./validite-abonnement.js";

describe("calculerDateFin — mode STRICT_30J", () => {
  it("cas de référence 4.2 : 16/11/2025, 1 cycle -> 15/12/2025", () => {
    expect(calculerDateFin("2025-11-16", 1, "STRICT_30J")).toBe("2025-12-15");
  });

  it("3 cycles (ex. 24H Sport, 90 jours) : +89 jours", () => {
    expect(calculerDateFin("2025-01-01", 3, "STRICT_30J")).toBe("2025-03-31");
  });

  it("12 cycles (ex. Netflix annuel, 360 jours) : +359 jours", () => {
    expect(calculerDateFin("2025-01-01", 12, "STRICT_30J")).toBe("2025-12-26");
  });

  // 12.2 : "cas limites du calcul de validité (changement d'année...)" —
  // cas de test de non-régression explicitement exigé par le cahier des charges
  it("changement d'année : 20 décembre + 1 cycle -> 18 janvier de l'année suivante", () => {
    expect(calculerDateFin("2025-12-20", 1, "STRICT_30J")).toBe("2026-01-18");
  });
});

describe("calculerDateFin — mode MOIS_CIVIL", () => {
  it("cas simple sans dépassement de fin de mois : 15/01 + 1 mois civil - 1j -> 14/02", () => {
    expect(calculerDateFin("2025-01-15", 1, "MOIS_CIVIL")).toBe("2025-02-14");
  });

  it("31 janvier + 1 mois civil, année non bissextile -> clamp fin février (4.1)", () => {
    expect(calculerDateFin("2025-01-31", 1, "MOIS_CIVIL")).toBe("2025-02-27");
  });

  it("31 janvier + 1 mois civil, année bissextile -> clamp au 29 février", () => {
    expect(calculerDateFin("2028-01-31", 1, "MOIS_CIVIL")).toBe("2028-02-28");
  });

  // 12.2 : "cas limites du calcul de validité (changement d'année...)" —
  // cas de test de non-régression explicitement exigé par le cahier des charges
  it("changement d'année : 15 décembre + 1 mois civil -> 14 janvier de l'année suivante", () => {
    expect(calculerDateFin("2025-12-15", 1, "MOIS_CIVIL")).toBe("2026-01-14");
  });

  it("changement d'année avec clamp de fin de mois : 31 décembre + 1 mois civil -> 30 janvier", () => {
    expect(calculerDateFin("2025-12-31", 1, "MOIS_CIVIL")).toBe("2026-01-30");
  });

  it("durée pluriannuelle : 1er janvier + 12 mois civils -> 31 décembre de la même année", () => {
    expect(calculerDateFin("2025-01-01", 12, "MOIS_CIVIL")).toBe("2025-12-31");
  });

  // 12.2 : "mois de 28/29/30/31 jours" — clamp sur un mois de 30 jours (avril)
  it("31 mars + 1 mois civil -> clamp fin avril (30 jours)", () => {
    expect(calculerDateFin("2025-03-31", 1, "MOIS_CIVIL")).toBe("2025-04-29");
  });
});
