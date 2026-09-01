import { describe, it, expect } from "vitest";
import { evaluerExpiration } from "./statut-abonnement.js";

describe("evaluerExpiration — job quotidien (4.3)", () => {
  it("bascule ACTIF -> EXPIRE quand aujourd'hui dépasse date_fin", () => {
    expect(evaluerExpiration("ACTIF", "2025-12-15", "2025-12-16")).toBe("EXPIRE");
  });

  it("reste ACTIF le dernier jour de validité inclus", () => {
    expect(evaluerExpiration("ACTIF", "2025-12-15", "2025-12-15")).toBe("ACTIF");
  });

  it("un abonnement RESILIE reste RESILIE (état terminal)", () => {
    expect(evaluerExpiration("RESILIE", "2025-12-15", "2026-01-01")).toBe("RESILIE");
  });

  it("un abonnement déjà EXPIRE reste EXPIRE (le job ne fait pas de réabonnement)", () => {
    expect(evaluerExpiration("EXPIRE", "2025-12-15", "2026-01-01")).toBe("EXPIRE");
  });
});
