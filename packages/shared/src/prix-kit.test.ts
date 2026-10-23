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

  // Le cahier des charges décrit ces kits comme « Décodeur + installation + formule GLOBAL » (StarTimes), « Décodeur + formule
  // FULL 24H SPORT 3 MOIS » (24H Sport) : le prix fixe couvre le matériel ET la première formule, comme les kits CANAL+ et DStv.
  // Les facturer en plus de la formule faisait payer 45 000 un kit 24H Sport affiché 30 000.
  it("prix fixe : le kit embarque la formule de départ (KIT STARTIMES 18 000 avec GLOBAL 10 500 -> 7 500 de matériel)", () => {
    const kit = { reglePrix: "PRIX_FIXE" as const, prixFixe: 18000 };
    expect(calculerPrixKitHorsFormule(kit, { idFormule: 1, prix: 10500 })).toBe(7500);
  });

  it("prix fixe : formule + matériel donnent toujours le prix fixe, quelle que soit la formule choisie", () => {
    const kit = { reglePrix: "PRIX_FIXE" as const, prixFixe: 30000 };
    for (const prixFormule of [5000, 15000, 30000]) {
      expect(prixFormule + calculerPrixKitHorsFormule(kit, { idFormule: 1, prix: prixFormule })).toBe(30000);
    }
  });

  it("prix fixe : refuse une formule plus chère que le kit, au lieu d'un matériel à prix négatif", () => {
    const kit = { reglePrix: "PRIX_FIXE" as const, prixFixe: 18000 };
    expect(() => calculerPrixKitHorsFormule(kit, { idFormule: 1, prix: 28000 })).toThrow(/inférieur/i);
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
