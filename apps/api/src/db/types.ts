import type { Database } from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./schema.js";

// $client expose la connexion better-sqlite3 sous-jacente — nécessaire pour
// les opérations hors du query builder drizzle (VACUUM INTO, 2.6)
export type Db = BetterSQLite3Database<typeof schema> & { $client: Database };
