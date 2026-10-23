import { describe, it, expect } from "vitest";
import { ligneAvecRemise } from "./lignes-remise.js";

const somme = (lignes: { montant: number }[]) => lignes.reduce((total, l) => total + l.montant, 0);

// 6.4, 6.7 : un ticket montre le prix catalogue puis la remise, pour que ses lignes totalisent le total affiché
describe("ligneAvecRemise", () => {
  it("sans remise : une seule ligne, au prix catalogue", () => {
    expect(ligneAvecRemise("FULL 24H SPORT 3 MOIS", 15000, 0)).toEqual([{ libelle: "FULL 24H SPORT 3 MOIS", montant: 15000 }]);
  });

  it("avec remise : la ligne au prix catalogue, puis une ligne « Remise » négative", () => {
    expect(ligneAvecRemise("FULL 24H SPORT 3 MOIS", 15000, 1000)).toEqual([
      { libelle: "FULL 24H SPORT 3 MOIS", montant: 15000 },
      { libelle: "Remise", montant: -1000 },
    ]);
  });

  it("les lignes totalisent le prix net (catalogue − remise)", () => {
    expect(somme(ligneAvecRemise("Câble HDMI × 2", 5000, 500))).toBe(4500);
  });

  it("le libellé de la remise peut nommer la ligne remisée (vente de plusieurs articles)", () => {
    expect(ligneAvecRemise("Câble HDMI × 2", 5000, 500, "Remise — Câble HDMI")[1]).toEqual({ libelle: "Remise — Câble HDMI", montant: -500 });
  });

  it("une remise nulle, négative ou absurde n'ajoute aucune ligne", () => {
    expect(ligneAvecRemise("X", 1000, -50)).toHaveLength(1);
    expect(ligneAvecRemise("X", 1000, Number.NaN)).toHaveLength(1);
  });
});
