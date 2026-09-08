import { describe, it, expect } from "vitest";
import { POLITIQUE_MDP_PAR_DEFAUT, validerMotDePasse } from "./politique-mot-de-passe.js";

describe("validerMotDePasse (11.2 : politique de complexité minimale configurable)", () => {
  it("accepte un mot de passe respectant la politique par défaut (8 caractères)", () => {
    expect(validerMotDePasse("secret12")).toEqual([]);
  });

  it("rejette un mot de passe trop court, avec le nombre minimal attendu", () => {
    expect(validerMotDePasse("court")).toEqual(["Le mot de passe doit contenir au moins 8 caractères"]);
  });

  it("respecte une longueur minimale personnalisée", () => {
    const politique = { ...POLITIQUE_MDP_PAR_DEFAUT, longueurMin: 12 };
    expect(validerMotDePasse("douze-lettres", politique)).toEqual([]);
    expect(validerMotDePasse("courte1234", politique)).toEqual(["Le mot de passe doit contenir au moins 12 caractères"]);
  });

  it("exige une majuscule quand la politique le demande", () => {
    const politique = { ...POLITIQUE_MDP_PAR_DEFAUT, exigerMajuscule: true };
    expect(validerMotDePasse("minuscule1", politique)).toEqual(["Le mot de passe doit contenir au moins une majuscule"]);
    expect(validerMotDePasse("Minuscule1", politique)).toEqual([]);
  });

  it("exige un chiffre quand la politique le demande", () => {
    const politique = { ...POLITIQUE_MDP_PAR_DEFAUT, exigerChiffre: true };
    expect(validerMotDePasse("sanschiffre", politique)).toEqual(["Le mot de passe doit contenir au moins un chiffre"]);
    expect(validerMotDePasse("avecchiffre1", politique)).toEqual([]);
  });

  it("exige un caractère spécial quand la politique le demande", () => {
    const politique = { ...POLITIQUE_MDP_PAR_DEFAUT, exigerCaractereSpecial: true };
    expect(validerMotDePasse("sansspecial1", politique)).toEqual(["Le mot de passe doit contenir au moins un caractère spécial"]);
    expect(validerMotDePasse("avecspecial1!", politique)).toEqual([]);
  });

  it("cumule toutes les règles violées", () => {
    const politique = { longueurMin: 10, exigerMajuscule: true, exigerChiffre: true, exigerCaractereSpecial: true };
    expect(validerMotDePasse("abc", politique)).toEqual([
      "Le mot de passe doit contenir au moins 10 caractères",
      "Le mot de passe doit contenir au moins une majuscule",
      "Le mot de passe doit contenir au moins un chiffre",
      "Le mot de passe doit contenir au moins un caractère spécial",
    ]);
  });
});
