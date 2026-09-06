import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../db/schema.js";
import type { Db } from "../../db/types.js";
import { creerSauvegarde, listerSauvegardes, nettoyerAnciennesSauvegardes } from "./sauvegarde.service.js";

let db: Db;
let dossireTemp: string;
let dossierSauvegardes: string;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  db.insert(schema.entreprise).values({ nom: "Boutique Test" }).run();

  dossireTemp = mkdtempSync(join(tmpdir(), "mboapilot-test-sauvegarde-"));
  dossierSauvegardes = join(dossireTemp, "backups");
});

afterEach(() => {
  rmSync(dossireTemp, { recursive: true, force: true });
});

describe("creerSauvegarde (2.6)", () => {
  it("crée un fichier de sauvegarde SQLite cohérent (VACUUM INTO), contenant les données actuelles", () => {
    const sauvegarde = creerSauvegarde(db, dossierSauvegardes, new Date("2026-09-06T03:00:00.000Z"));

    const chemin = join(dossierSauvegardes, sauvegarde.nomFichier);
    expect(existsSync(chemin)).toBe(true);
    expect(sauvegarde.tailleOctets).toBeGreaterThan(0);

    const copie = new Database(chemin, { readonly: true });
    const lignes = copie.prepare("SELECT nom FROM entreprise").all() as { nom: string }[];
    expect(lignes).toEqual([{ nom: "Boutique Test" }]);
    copie.close();
  });

  it("crée le dossier de sauvegardes s'il n'existe pas encore", () => {
    expect(existsSync(dossierSauvegardes)).toBe(false);
    creerSauvegarde(db, dossierSauvegardes, new Date());
    expect(existsSync(dossierSauvegardes)).toBe(true);
  });

  it("horodate chaque fichier de façon unique et triable", () => {
    const s1 = creerSauvegarde(db, dossierSauvegardes, new Date("2026-09-04T03:00:00.000Z"));
    const s2 = creerSauvegarde(db, dossierSauvegardes, new Date("2026-09-05T03:00:00.000Z"));
    expect(s1.nomFichier).not.toBe(s2.nomFichier);
    expect([s1.nomFichier, s2.nomFichier].sort()).toEqual([s1.nomFichier, s2.nomFichier]);
  });
});

describe("listerSauvegardes (2.6)", () => {
  it("liste les sauvegardes existantes, la plus récente en premier", () => {
    creerSauvegarde(db, dossierSauvegardes, new Date("2026-09-04T03:00:00.000Z"));
    creerSauvegarde(db, dossierSauvegardes, new Date("2026-09-05T03:00:00.000Z"));

    const liste = listerSauvegardes(dossierSauvegardes);

    expect(liste).toHaveLength(2);
    expect(liste[0].nomFichier > liste[1].nomFichier).toBe(true);
  });

  it("renvoie un tableau vide si le dossier n'existe pas encore", () => {
    expect(listerSauvegardes(dossierSauvegardes)).toEqual([]);
  });
});

describe("nettoyerAnciennesSauvegardes (2.6 : conservation glissante 30 jours)", () => {
  it("supprime les sauvegardes plus vieilles que le délai de conservation, conserve les récentes", () => {
    const ancienne = creerSauvegarde(db, dossierSauvegardes, new Date("2026-07-01T03:00:00.000Z"));
    const recente = creerSauvegarde(db, dossierSauvegardes, new Date("2026-09-01T03:00:00.000Z"));

    const supprimees = nettoyerAnciennesSauvegardes(dossierSauvegardes, 30, new Date("2026-09-06T00:00:00.000Z"));

    expect(supprimees).toEqual([ancienne.nomFichier]);
    const restantes = listerSauvegardes(dossierSauvegardes);
    expect(restantes.map((s) => s.nomFichier)).toEqual([recente.nomFichier]);
  });

  it("ne supprime rien si toutes les sauvegardes sont dans le délai", () => {
    creerSauvegarde(db, dossierSauvegardes, new Date("2026-09-05T03:00:00.000Z"));

    const supprimees = nettoyerAnciennesSauvegardes(dossierSauvegardes, 30, new Date("2026-09-06T00:00:00.000Z"));

    expect(supprimees).toEqual([]);
    expect(listerSauvegardes(dossierSauvegardes)).toHaveLength(1);
  });
});
