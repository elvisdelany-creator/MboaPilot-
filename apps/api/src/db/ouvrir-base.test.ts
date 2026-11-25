import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ouvrirBase } from "./ouvrir-base.js";

let dossier: string;
let chemin: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), "mboapilot-test-ouverture-"));
  chemin = join(dossier, "donnees", "mboapilot.db");
});
afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

const preparerDossier = () => ouvrirBase(chemin).close();
const reglage = (nom: string) => {
  const base = ouvrirBase(chemin);
  try {
    // SQLite n'applique le réglage par défaut du mode WAL qu'à la première lecture : sans elle, la mesure serait trompeuse
    base.prepare("select count(*) from sqlite_master").get();
    return base.pragma(nom, { simple: true });
  } finally {
    base.close();
  }
};

describe("ouvrirBase : réglages de la base de la boutique", () => {
  it("crée le dossier et la base à la première installation", () => {
    preparerDossier();
    expect(existsSync(chemin)).toBe(true);
  });

  it("un seul écrivain en mode WAL, clés étrangères contrôlées", () => {
    expect(reglage("journal_mode")).toBe("wal");
    expect(reglage("foreign_keys")).toBe(1);
  });

  // avec NORMAL (réglage précédent), une vente confirmée à l'écran et imprimée pouvait disparaître à la coupure de courant suivante
  it("attend que le disque ait écrit avant de confirmer (synchronous = FULL)", () => {
    expect(reglage("synchronous")).toBe(2);
  });
});

// Test grandeur nature « reprise sur panne » : après une restauration interrompue, le serveur créait en silence une base vide et proposait la
// première installation, comme si la boutique n'avait jamais existé.
describe("ouvrirBase : jamais de base vide à la place d'une restauration interrompue", () => {
  it.each([
    "mboapilot.db.avant-restauration",
    "mboapilot.db.avant-restauration.2026-11-25T10-00-00-000Z",
    "mboapilot.db.restauration-en-cours",
  ])("base absente à côté de « %s » : refus expliqué, aucune base créée", (reste) => {
    preparerDossier();
    rmSync(chemin);
    writeFileSync(join(dossier, "donnees", reste), "contenu");

    expect(() => ouvrirBase(chemin).close()).toThrow(/restauration.*interrompue/i);
    expect(() => ouvrirBase(chemin).close()).toThrow(/db:restaurer/);
    expect(existsSync(chemin)).toBe(false);
  });

  it("démarre normalement quand la base est là, avec les fichiers laissés par une restauration réussie", () => {
    preparerDossier();
    writeFileSync(`${chemin}.avant-restauration`, "ancienne base");

    expect(() => preparerDossier()).not.toThrow();
  });
});
