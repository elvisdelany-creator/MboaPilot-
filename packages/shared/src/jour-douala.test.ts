import { describe, expect, it } from "vitest";
import { bornesJourDouala, jourDouala } from "./jour-douala.js";

describe("jourDouala : le jour de la boutique est celui de Douala (UTC+1, sans changement d'heure)", () => {
  it("00h30 à Douala est encore la veille en UTC : c'est bien le nouveau jour", () => {
    expect(jourDouala(new Date("2026-10-20T23:30:00Z"))).toBe("2026-10-21");
  });

  it("23h30 à Douala est déjà le lendemain, minuit passé, en UTC : c'est encore le même jour", () => {
    expect(jourDouala(new Date("2026-10-21T22:30:00Z"))).toBe("2026-10-21");
  });

  it("bascule exactement à 23h00 UTC (minuit à Douala)", () => {
    expect(jourDouala(new Date("2026-10-20T22:59:59Z"))).toBe("2026-10-20");
    expect(jourDouala(new Date("2026-10-20T23:00:00Z"))).toBe("2026-10-21");
  });

  it("lit aussi un horodatage SQLite (UTC, sans fuseau) ou ISO", () => {
    expect(jourDouala("2026-10-20 23:30:00")).toBe("2026-10-21");
    expect(jourDouala("2026-10-20T22:30:00.000Z")).toBe("2026-10-20");
  });

  it("passe correctement la fin d'année et le 29 février", () => {
    expect(jourDouala("2026-12-31 23:15:00")).toBe("2027-01-01");
    expect(jourDouala("2028-02-28 23:15:00")).toBe("2028-02-29");
  });

  it("sans argument, renvoie le jour courant au format AAAA-MM-JJ", () => {
    expect(jourDouala()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("bornesJourDouala : plage UTC (format SQLite) couvrant un jour de Douala", () => {
  it("le jour J va de la veille 23:00:00 UTC (inclus) à J 23:00:00 UTC (exclu)", () => {
    expect(bornesJourDouala("2026-10-21")).toEqual({ debut: "2026-10-20 23:00:00", fin: "2026-10-21 23:00:00" });
  });

  it("enjambe les mois et les années", () => {
    expect(bornesJourDouala("2027-01-01")).toEqual({ debut: "2026-12-31 23:00:00", fin: "2027-01-01 23:00:00" });
    expect(bornesJourDouala("2026-03-01")).toEqual({ debut: "2026-02-28 23:00:00", fin: "2026-03-01 23:00:00" });
  });

  it("est cohérente avec jourDouala : une vente de 00h30 tombe dans le bon jour, celle de 22h59 UTC dans la veille", () => {
    const { debut, fin } = bornesJourDouala("2026-10-21");
    const dans = (h: string) => h >= debut && h < fin;
    expect(dans("2026-10-20 23:30:00")).toBe(true);
    expect(dans("2026-10-20 22:59:59")).toBe(false);
    expect(dans("2026-10-21 22:59:59")).toBe(true);
    expect(dans("2026-10-21 23:00:00")).toBe(false);
  });
});
