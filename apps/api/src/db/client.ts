import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cheminBase } from "../config/chemins.js";

const DB_PATH = cheminBase();

// première installation : le dossier de données n'existe pas encore
mkdirSync(dirname(DB_PATH), { recursive: true });
const sqlite = new Database(DB_PATH);

// non négociable — 2.4 : un seul écrivain, jamais de "database is locked"
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
