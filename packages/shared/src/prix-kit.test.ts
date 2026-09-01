import { describe, it, expect } from "vitest";
import { calculerPrixKit } from "./prix-kit.js";

describe("calculerPrixKit (5.1.1)", () => {
  it("PRIX_FIXE : renvoie le prix fixe quelle que soit la formule (ex. KIT STARTIMES)", () => {
    const kit = { reglePrix: "PRIX_FIXE" as const, prixFixe: 18000 };
    expect(calculerPrixKit(kit, { idFormule: 1, prix: 10500 })).toBe(18000);
  });

  it("PRIX_DECODEUR_VARIABLE_SELON_FORMULE : GLOBALZ base EVASION -> 15 500 FCFA", () => {
    const kit = {
      reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" as const,
      prixParaboleAccessoires: 0,
      prixDecodeurParFormule: { 1: 5000, 2: 1000 },
    };
    expect(calculerPrixKit(kit, { idFormule: 1, prix: 10500 })).toBe(15500);
  });

  it("PRIX_DECODEUR_VARIABLE_SELON_FORMULE : GLOBALZ base TOUT CANAL+ -> 29 000 FCFA", () => {
    const kit = {
      reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" as const,
      prixParaboleAccessoires: 0,
      prixDecodeurParFormule: { 1: 5000, 2: 1000 },
    };
    expect(calculerPrixKit(kit, { idFormule: 2, prix: 28000 })).toBe(29000);
  });

  it("PRIX_KIT_FIXE_PAR_DIFFERENTIEL : DSTV COMPAQ vers PREMIUM -> 70 000 FCFA", () => {
    const kit = {
      reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL" as const,
      prixKitReference: 55000,
      formuleReference: { idFormule: 10, prix: 13000 },
    };
    expect(calculerPrixKit(kit, { idFormule: 11, prix: 28000 })).toBe(70000);
  });
});
