import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { restaurerSauvegarde } from "./restaurer-sauvegarde.service.js";

let dossier: string;

function creerBase(nom: string, valeur: string): string {
  const chemin = join(dossier, nom);
  const base = new Database(chemin);
  base.exec("create table t(v text)");
  base.prepare("insert into t values (?)").run(valeur);
  base.close();
  return chemin;
}

function lire(chemin: string): string {
  const base = new Database(chemin, { readonly: true });
  try {
    return (base.prepare("select v from t").get() as { v: string }).v;
  } finally {
    base.close();
  }
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), "mboapilot-test-restauration-"));
});
afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

describe("restaurerSauvegarde (2.6)", () => {
  it("remplace la base et conserve l'ancienne sous .avant-restauration", () => {
    const base = creerBase("mboapilot.db", "actuelle");
    const sauvegarde = creerBase("A.db", "sauvegarde-A");

    restaurerSauvegarde(sauvegarde, base);

    expect(lire(base)).toBe("sauvegarde-A");
    expect(lire(`${base}.avant-restauration`)).toBe("actuelle");
  });

  it("refuse un fichier qui n'est pas une base saine, sans toucher à la base actuelle", () => {
    const base = creerBase("mboapilot.db", "actuelle");
    const faux = join(dossier, "faux.db");
    writeFileSync(faux, "ceci n'est pas une base SQLite, loin de là ".repeat(50));

    expect(() => restaurerSauvegarde(faux, base)).toThrow();

    expect(lire(base)).toBe("actuelle");
    expect(existsSync(`${base}.avant-restauration`)).toBe(false);
  });

  // Une 2e restauration (mauvaise sauvegarde choisie d'abord, puis la bonne) écrasait le filet de sécurité :
  // les données d'avant la toute première restauration étaient perdues sans le moindre message.
  it("n'écrase jamais l'ancien filet de sécurité lors d'une deuxième restauration", () => {
    const base = creerBase("mboapilot.db", "actuelle");
    const a = creerBase("A.db", "sauvegarde-A");
    const b = creerBase("B.db", "sauvegarde-B");

    restaurerSauvegarde(a, base);
    restaurerSauvegarde(b, base);

    expect(lire(base)).toBe("sauvegarde-B");
    const conservees = readdirSync(dossier).filter((f) => f.startsWith("mboapilot.db.avant-restauration"));
    const contenus = conservees.map((f) => lire(join(dossier, f))).sort();
    expect(contenus).toEqual(["actuelle", "sauvegarde-A"]);
    // la plus récente garde le nom documenté
    expect(lire(`${base}.avant-restauration`)).toBe("sauvegarde-A");
  });
});
