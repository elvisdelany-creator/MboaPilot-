import { describe, it, expect } from "vitest";
import { erreursConfigurationHeberge, estModeHeberge } from "./mode-heberge.js";

const SECRET = "s".repeat(40);
const CLE = "ab".repeat(32);
const BONNE = { MBOAPILOT_HEBERGE: "1", JWT_SECRET: SECRET, MBOAPILOT_ENCRYPTION_KEY: CLE, MBOAPILOT_PROXY: "1" };

describe("estModeHeberge", () => {
  it("n'est actif que si MBOAPILOT_HEBERGE vaut exactement 1 : un poste de caisse ne bascule jamais par hasard", () => {
    expect(estModeHeberge({ MBOAPILOT_HEBERGE: "1" })).toBe(true);
    for (const valeur of [undefined, "", "0", "true", "oui", "2"]) expect(estModeHeberge({ MBOAPILOT_HEBERGE: valeur })).toBe(false);
  });
});

describe("erreursConfigurationHeberge : le serveur refuse de démarrer exposé sur Internet avec une configuration dangereuse", () => {
  it("hors mode hébergé, rien n'est exigé (un poste local démarre sans aucun réglage)", () => {
    expect(erreursConfigurationHeberge({})).toEqual([]);
    expect(erreursConfigurationHeberge({ MBOAPILOT_PROXY: "0" })).toEqual([]);
  });

  it("une configuration complète ne produit aucune erreur", () => {
    expect(erreursConfigurationHeberge(BONNE)).toEqual([]);
  });

  it("exige un secret de session fixé, d'au moins 32 caractères : généré au hasard sur le disque, il serait perdu avec le serveur", () => {
    expect(erreursConfigurationHeberge({ ...BONNE, JWT_SECRET: undefined }).join(" ")).toMatch(/JWT_SECRET/);
    expect(erreursConfigurationHeberge({ ...BONNE, JWT_SECRET: "court" }).join(" ")).toMatch(/JWT_SECRET.*32/);
  });

  it("exige la clé de chiffrement fixée : sans elle, les comptes partagés chiffrés sont illisibles après une restauration", () => {
    expect(erreursConfigurationHeberge({ ...BONNE, MBOAPILOT_ENCRYPTION_KEY: undefined }).join(" ")).toMatch(/MBOAPILOT_ENCRYPTION_KEY/);
  });

  it.each([undefined, "", "0", "-1", "abc", "1.5"])("exige le nombre de proxys (MBOAPILOT_PROXY=%j) : sans lui, le plafond de débit compterait l'adresse du proxy", (valeur) => {
    expect(erreursConfigurationHeberge({ ...BONNE, MBOAPILOT_PROXY: valeur }).join(" ")).toMatch(/MBOAPILOT_PROXY/);
  });

  it("refuse de cohabiter avec la démo publique (boutique fictive, comptes partagés)", () => {
    expect(erreursConfigurationHeberge({ ...BONNE, MBOAPILOT_DEMO: "1" }).join(" ")).toMatch(/démo/i);
  });

  it("refuse le simulateur Mobile Money : il déclare payé tout paiement, que le client ait payé ou non", () => {
    expect(erreursConfigurationHeberge({ ...BONNE, MBOAPILOT_MOBILE_MONEY_SIMULE: "1" }).join(" ")).toMatch(/Mobile Money/i);
  });

  it("liste toutes les erreurs d'un coup, pour tout corriger en une fois", () => {
    const erreurs = erreursConfigurationHeberge({ MBOAPILOT_HEBERGE: "1" });
    expect(erreurs.length).toBeGreaterThanOrEqual(3);
  });
});
