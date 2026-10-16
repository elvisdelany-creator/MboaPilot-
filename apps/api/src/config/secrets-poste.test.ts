import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { obtenirSecretJwt } from "./jwt-secret.js";
import { obtenirCleChiffrement } from "./encryption-key.js";

let dossier: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), "mboapilot-test-secrets-"));
  vi.stubEnv("JWT_SECRET", "");
  vi.stubEnv("MBOAPILOT_ENCRYPTION_KEY", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dossier, { recursive: true, force: true });
});

// Les deux fichiers sont écrits au premier démarrage : une coupure de courant à ce moment-là, ou une
// copie incomplète vers un autre poste, laisse un fichier vide ou tronqué.
describe("obtenirSecretJwt : fichier de secret du poste", () => {
  it("génère puis relit le même secret", () => {
    const chemin = join(dossier, ".jwt-secret");
    const premier = obtenirSecretJwt(chemin);
    expect(premier.length).toBeGreaterThanOrEqual(32);
    expect(obtenirSecretJwt(chemin)).toBe(premier);
  });

  it("régénère un secret quand le fichier est vide (au lieu de signer les sessions avec une chaîne vide)", () => {
    const chemin = join(dossier, ".jwt-secret");
    writeFileSync(chemin, "");

    const secret = obtenirSecretJwt(chemin);

    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(chemin, "utf-8").trim()).toBe(secret);
  });

  it("régénère un secret quand le fichier ne contient que des espaces", () => {
    const chemin = join(dossier, ".jwt-secret");
    writeFileSync(chemin, "  \r\n");
    expect(obtenirSecretJwt(chemin).length).toBeGreaterThanOrEqual(32);
  });
});

describe("obtenirCleChiffrement : fichier de clé du poste", () => {
  it("génère une clé de 32 octets puis la relit à l'identique", () => {
    const chemin = join(dossier, ".encryption-key");
    const premiere = obtenirCleChiffrement(chemin);
    expect(premiere).toHaveLength(32);
    expect(obtenirCleChiffrement(chemin).equals(premiere)).toBe(true);
  });

  // Régénérer en silence masquerait le problème et écraserait un fichier que l'administrateur est peut-être
  // en train de réparer depuis une copie : l'erreur doit être explicite, avec la marche à suivre.
  it("refuse un fichier de clé tronqué, avec un message clair, sans le réécrire", () => {
    const chemin = join(dossier, ".encryption-key");
    writeFileSync(chemin, "ab12cd34");

    expect(() => obtenirCleChiffrement(chemin)).toThrow(/clé de chiffrement.*invalide/i);
    expect(readFileSync(chemin, "utf-8")).toBe("ab12cd34");
  });

  it("refuse un fichier de clé vide", () => {
    const chemin = join(dossier, ".encryption-key");
    writeFileSync(chemin, "");
    expect(() => obtenirCleChiffrement(chemin)).toThrow(/invalide/i);
    expect(existsSync(chemin)).toBe(true);
  });

  it("refuse une clé non hexadécimale", () => {
    const chemin = join(dossier, ".encryption-key");
    writeFileSync(chemin, "z".repeat(64));
    expect(() => obtenirCleChiffrement(chemin)).toThrow(/invalide/i);
  });

  it("refuse une variable d'environnement de mauvaise longueur", () => {
    vi.stubEnv("MBOAPILOT_ENCRYPTION_KEY", "abcd");
    expect(() => obtenirCleChiffrement(join(dossier, ".encryption-key"))).toThrow(/invalide/i);
  });
});
