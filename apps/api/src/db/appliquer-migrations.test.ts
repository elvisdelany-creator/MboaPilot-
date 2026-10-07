import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "./schema.js";
import type { Db } from "./types.js";
import { appliquerMigrations } from "./appliquer-migrations.js";

// 2.6 : « la restauration ne doit jamais nécessiter d'intervention développeur » —
// constaté en test grandeur nature : le serveur démarré sur une sauvegarde plus
// ancienne que le code plantait (« no such table: licence ») tant que
// `npm run db:migrate` n'était pas lancé à la main. Même cas après une mise à
// jour de l'application.
function tables(db: Db): string[] {
  return db.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => (r as { name: string }).name);
}

describe("appliquerMigrations (2.6 : démarrage sur une base plus ancienne que le code)", () => {
  it("met à niveau une base restaurée depuis une sauvegarde ancienne, sans perdre ses données", () => {
    // base « ancienne » : seulement les 5 premières migrations appliquées
    const dossier = mkdtempSync(join(tmpdir(), "migrations-"));
    try {
      cpSync("./src/db/migrations", dossier, { recursive: true });
      const journal = JSON.parse(readFileSync(join(dossier, "meta", "_journal.json"), "utf8"));
      const journalComplet = JSON.stringify(journal);
      journal.entries = journal.entries.slice(0, 5);
      writeFileSync(join(dossier, "meta", "_journal.json"), JSON.stringify(journal));

      const sqlite = new Database(":memory:");
      sqlite.pragma("foreign_keys = ON");
      const db = drizzle(sqlite, { schema }) as Db;
      migrate(db, { migrationsFolder: dossier });
      sqlite.prepare("INSERT INTO entreprise (nom) VALUES ('Boutique restaurée')").run();
      expect(tables(db)).not.toContain("licence");

      writeFileSync(join(dossier, "meta", "_journal.json"), journalComplet);
      appliquerMigrations(db, dossier);

      expect(tables(db)).toContain("licence");
      expect(db.select().from(schema.entreprise).all().map((e) => e.nom)).toEqual(["Boutique restaurée"]);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it("est sans effet sur une base déjà à jour (idempotent)", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite, { schema }) as Db;
    appliquerMigrations(db);
    const avant = tables(db);

    expect(() => appliquerMigrations(db)).not.toThrow();
    expect(tables(db)).toEqual(avant);
  });
});
