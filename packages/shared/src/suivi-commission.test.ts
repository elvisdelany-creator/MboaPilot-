import { describe, it, expect } from "vitest";
import { evaluerSuiviCommission } from "./suivi-commission.js";

describe("evaluerSuiviCommission — job quotidien (6.2)", () => {
  it("annule la commission si l'abonnement expire pendant la période probatoire", () => {
    expect(evaluerSuiviCommission("EN_COURS", "EXPIRE", "2026-03-15", "2026-02-01", "2026-01-30")).toBe("ANNULEE");
  });

  it("confirme la commission une fois la période probatoire dépassée sans expiration", () => {
    expect(evaluerSuiviCommission("EN_COURS", "ACTIF", "2026-03-15", "2026-03-16", "2026-04-10")).toBe("CONFIRMEE");
  });

  it("reste en cours tant que la période probatoire n'est pas dépassée et l'abonnement est encore actif", () => {
    expect(evaluerSuiviCommission("EN_COURS", "ACTIF", "2026-03-15", "2026-02-01", "2026-02-10")).toBe("EN_COURS");
  });

  it("un réabonnement à temps (abonnement de nouveau ACTIF) maintient le suivi en cours", () => {
    expect(evaluerSuiviCommission("EN_COURS", "ACTIF", "2026-03-15", "2026-03-10", "2026-04-09")).toBe("EN_COURS");
  });

  it("un suivi déjà CONFIRMEE ou ANNULEE est un état terminal, jamais réévalué", () => {
    expect(evaluerSuiviCommission("CONFIRMEE", "EXPIRE", "2026-03-15", "2026-04-01", "2026-01-30")).toBe("CONFIRMEE");
    expect(evaluerSuiviCommission("ANNULEE", "ACTIF", "2026-03-15", "2026-04-01", "2026-04-10")).toBe("ANNULEE");
  });

  // 6.2.3 : "si l'abonnement bascule en EXPIRE à un moment quelconque de la
  // période probatoire, le suivi passe à ANNULÉE" — y compris quand
  // l'expiration n'est constatée qu'après la fin de cette période (job
  // indisponible quelques jours, recrutement antidaté). Constaté en test
  // grandeur nature : un recrutement antidaté de 5 mois, jamais renouvelé,
  // voyait sa commission passer à CONFIRMEE dès le premier job.
  it("annule la commission d'un abonnement expiré avant la fin de la période probatoire, même constaté après celle-ci", () => {
    expect(evaluerSuiviCommission("EN_COURS", "EXPIRE", "2026-03-15", "2026-10-01", "2026-01-30")).toBe("ANNULEE");
  });

  it("confirme la commission d'un client à jour jusqu'au bout de la période probatoire, même si l'expiration n'est constatée que plus tard", () => {
    expect(evaluerSuiviCommission("EN_COURS", "EXPIRE", "2026-03-15", "2026-03-20", "2026-03-15")).toBe("CONFIRMEE");
    expect(evaluerSuiviCommission("EN_COURS", "EXPIRE", "2026-03-15", "2026-03-20", "2026-04-10")).toBe("CONFIRMEE");
  });
});
