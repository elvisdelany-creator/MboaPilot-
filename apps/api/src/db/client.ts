import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { cheminBase } from "../config/chemins.js";
import { ouvrirBase } from "./ouvrir-base.js";

function ouvrirOuArreter() {
  try {
    return ouvrirBase(cheminBase());
  } catch (erreur) {
    console.error(`[MboaPilot] Démarrage impossible : ${(erreur as Error).message}`);
    process.exit(1);
  }
}

export const db = drizzle(ouvrirOuArreter(), { schema });
