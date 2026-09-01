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
});
