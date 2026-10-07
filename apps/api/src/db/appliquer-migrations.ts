import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import type { Db } from "./types.js";

const DOSSIER_MIGRATIONS = fileURLToPath(new URL("./migrations", import.meta.url));

// 2.6 : applique les migrations manquantes (idempotent). Appelé au démarrage du
// serveur : une base restaurée depuis une sauvegarde ancienne, ou l'application
// mise à jour sur une base existante, est ainsi mise à niveau sans commande
// manuelle ni intervention développeur.
export function appliquerMigrations(db: Db, dossier: string = DOSSIER_MIGRATIONS): void {
  migrate(db, { migrationsFolder: dossier });
}
