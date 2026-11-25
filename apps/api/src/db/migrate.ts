import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cheminBase } from "../config/chemins.js";
import { ouvrirBase } from "./ouvrir-base.js";

const DB_PATH = cheminBase();

const sqlite = ouvrirBase(DB_PATH);

const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./src/db/migrations" });

console.log(`Migrations appliquées sur ${DB_PATH}`);
sqlite.close();
