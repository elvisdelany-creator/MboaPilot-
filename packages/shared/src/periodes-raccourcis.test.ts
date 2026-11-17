import { describe, it, expect } from "vitest";
import { raccourcisPeriode } from "./periodes-raccourcis.js";

const periodes = (jour: string) => Object.fromEntries(raccourcisPeriode(jour).map((r) => [r.cle, r.periode]));

describe("raccourcisPeriode", () => {
  it("un mardi (17 novembre 2026) : la semaine commence le lundi 16", () => {
    expect(periodes("2026-11-17")).toEqual({
      aujourdhui: { du: "2026-11-17", au: "2026-11-17" },
      hier: { du: "2026-11-16", au: "2026-11-16" },
      semaine: { du: "2026-11-16", au: "2026-11-17" },
      mois: { du: "2026-11-01", au: "2026-11-17" },
      moisDernier: { du: "2026-10-01", au: "2026-10-31" },
    });
  });

  it("un dimanche, la semaine en cours a commencé le lundi précédent (semaine du lundi au dimanche)", () => {
    expect(periodes("2026-11-15").semaine).toEqual({ du: "2026-11-09", au: "2026-11-15" });
  });

  it("un lundi, la semaine ne contient que ce jour", () => {
    expect(periodes("2026-11-16").semaine).toEqual({ du: "2026-11-16", au: "2026-11-16" });
  });

  it("le 1er du mois : « hier » est le dernier jour du mois précédent, « ce mois » se réduit à ce jour", () => {
    const p = periodes("2026-12-01");

    expect(p.hier).toEqual({ du: "2026-11-30", au: "2026-11-30" });
    expect(p.mois).toEqual({ du: "2026-12-01", au: "2026-12-01" });
    expect(p.moisDernier).toEqual({ du: "2026-11-01", au: "2026-11-30" });
  });

  it("en janvier, le mois dernier est décembre de l'année précédente", () => {
    expect(periodes("2027-01-10").moisDernier).toEqual({ du: "2026-12-01", au: "2026-12-31" });
  });

  it("donne les libellés de l'écran, dans l'ordre", () => {
    expect(raccourcisPeriode("2026-11-17").map((r) => r.libelle)).toEqual(["Aujourd'hui", "Hier", "Cette semaine", "Ce mois", "Mois dernier"]);
  });
});
