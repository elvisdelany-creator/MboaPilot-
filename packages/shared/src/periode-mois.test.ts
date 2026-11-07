import { describe, expect, it } from "vitest";
import { periodeDuMois } from "./periode-mois.js";

// raccourcis « mois en cours » / « mois dernier » de l'export comptable : le comptable clôture mois par mois
describe("periodeDuMois", () => {
  it("donne le premier et le dernier jour du mois du jour de référence", () => {
    expect(periodeDuMois("2026-11-07")).toEqual({ du: "2026-11-01", au: "2026-11-30" });
  });

  it("décale d'un mois en arrière", () => {
    expect(periodeDuMois("2026-11-07", -1)).toEqual({ du: "2026-10-01", au: "2026-10-31" });
  });

  it("passe le changement d'année dans les deux sens", () => {
    expect(periodeDuMois("2026-01-15", -1)).toEqual({ du: "2025-12-01", au: "2025-12-31" });
    expect(periodeDuMois("2026-12-15", 1)).toEqual({ du: "2027-01-01", au: "2027-01-31" });
  });

  it("connaît la longueur de février, bissextile ou non", () => {
    expect(periodeDuMois("2026-02-10").au).toBe("2026-02-28");
    expect(periodeDuMois("2028-02-10").au).toBe("2028-02-29");
  });

  it("un mois de 31 jours depuis un mois de 30 : le jour de référence ne déborde pas", () => {
    expect(periodeDuMois("2026-03-31", -1)).toEqual({ du: "2026-02-01", au: "2026-02-28" });
  });
});
