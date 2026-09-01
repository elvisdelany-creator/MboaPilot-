import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const DB_PATH = process.env.MBOAPILOT_DB_PATH ?? "./data/mboapilot.db";

const sqlite = new Database(DB_PATH);

// non négociable — 2.4 : un seul écrivain, jamais de "database is locked"
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
