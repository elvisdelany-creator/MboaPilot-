import { describe, it, expect } from "vitest";
import { evaluerSuiviCommission } from "./suivi-commission.js";

describe("evaluerSuiviCommission — job quotidien (6.2)", () => {
  it("annule la commission si l'abonnement expire pendant la période probatoire", () => {
    expect(evaluerSuiviCommission("EN_COURS", "EXPIRE", "2026-03-15", "2026-02-01")).toBe("ANNULEE");
  });

  it("confirme la commission une fois la période probatoire dépassée sans expiration", () => {
    expect(evaluerSuiviCommission("EN_COURS", "ACTIF", "2026-03-15", "2026-03-16")).toBe("CONFIRMEE");
  });

  it("reste en cours tant que la période probatoire n'est pas dépassée et l'abonnement est encore actif", () => {
    expect(evaluerSuiviCommission("EN_COURS", "ACTIF", "2026-03-15", "2026-02-01")).toBe("EN_COURS");
  });

  it("un réabonnement à temps (abonnement de nouveau ACTIF) maintient le suivi en cours", () => {
    expect(evaluerSuiviCommission("EN_COURS", "ACTIF", "2026-03-15", "2026-03-10")).toBe("EN_COURS");
  });

  it("un suivi déjà CONFIRMEE ou ANNULEE est un état terminal, jamais réévalué", () => {
    expect(evaluerSuiviCommission("CONFIRMEE", "EXPIRE", "2026-03-15", "2026-04-01")).toBe("CONFIRMEE");
    expect(evaluerSuiviCommission("ANNULEE", "ACTIF", "2026-03-15", "2026-04-01")).toBe("ANNULEE");
  });
});
