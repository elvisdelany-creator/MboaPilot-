import { describe, it, expect } from "vitest";
import { calculerPrixKit, calculerPrixKitHorsFormule } from "./prix-kit.js";

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

  // 5.1.1 : "afin que l'ajout d'un nouvel opérateur ou d'une nouvelle formule
  // ne nécessite qu'une saisie de paramétrage, jamais une évolution de
  // code" — une formule ajoutée sans grille de prix décodeur doit être
  // signalée clairement, jamais silencieusement calculée en NaN
  it("PRIX_DECODEUR_VARIABLE_SELON_FORMULE : lève une erreur si aucun prix décodeur n'est configuré pour la formule choisie", () => {
    const kit = {
      reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" as const,
      prixParaboleAccessoires: 0,
      prixDecodeurParFormule: { 1: 5000, 2: 1000 },
    };
    expect(() => calculerPrixKit(kit, { idFormule: 3, prix: 15000 })).toThrow(/prix.*décodeur.*non configuré/i);
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

// 5.1.1 : "prix_kit = prix_decodeur + prix_parabole_accessoires + prix_formule_choisie"
// — le kit embarque déjà sa formule de départ ; seule la part matériel reste
// à facturer en plus de la ligne formule
describe("calculerPrixKitHorsFormule (5.1.1)", () => {
  it("décodeur variable : retire la formule incluse (GLOBALZ base EVASION 15 500 -> 5 000 de matériel)", () => {
    const kit = {
      reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" as const,
      prixParaboleAccessoires: 0,
      prixDecodeurParFormule: { 1: 5000 },
    };
    expect(calculerPrixKitHorsFormule(kit, { idFormule: 1, prix: 10500 })).toBe(5000);
  });

  it("différentiel : retire la formule incluse (kit DStv 55 000 sur COMPAQ 13 000 -> 42 000 de matériel)", () => {
    const kit = {
      reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL" as const,
      prixKitReference: 55000,
      formuleReference: { idFormule: 10, prix: 13000 },
    };
    expect(calculerPrixKitHorsFormule(kit, { idFormule: 10, prix: 13000 })).toBe(42000);
  });

  it("prix fixe : le kit n'embarque pas la formule, son prix reste entier", () => {
    const kit = { reglePrix: "PRIX_FIXE" as const, prixFixe: 18000 };
    expect(calculerPrixKitHorsFormule(kit, { idFormule: 1, prix: 10500 })).toBe(18000);
  });

  it("lève l'erreur de prix non configuré, comme calculerPrixKit", () => {
    const kit = {
      reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" as const,
      prixParaboleAccessoires: 0,
      prixDecodeurParFormule: { 1: 5000 },
    };
    expect(() => calculerPrixKitHorsFormule(kit, { idFormule: 9, prix: 15000 })).toThrow(/non configuré/i);
  });
});
