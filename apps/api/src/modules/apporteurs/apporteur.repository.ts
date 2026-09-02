import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface CreerApporteurInput {
  nom: string;
  telephone?: string;
  tauxCommissionDefaut?: number; // pour-mille
}

// 6.3 : sous-distributeurs et apporteurs d'affaires
export function creerApporteur(db: Db, input: CreerApporteurInput) {
  return db
    .insert(schema.sousDistributeur)
    .values({ nom: input.nom, telephone: input.telephone, tauxCommissionDefaut: input.tauxCommissionDefaut })
    .returning()
    .get();
}

export function trouverApporteur(db: Db, idApporteur: number) {
  return db.select().from(schema.sousDistributeur).where(eq(schema.sousDistributeur.idApporteur, idApporteur)).get();
}

export function listerApporteurs(db: Db) {
  return db.select().from(schema.sousDistributeur).all();
}

export interface ModifierApporteurInput {
  actif?: boolean;
  tauxCommissionDefaut?: number;
}

export function modifierApporteur(db: Db, idApporteur: number, input: ModifierApporteurInput) {
  return db
    .update(schema.sousDistributeur)
    .set({
      ...(input.actif !== undefined && { actif: input.actif ? 1 : 0 }),
      ...(input.tauxCommissionDefaut !== undefined && { tauxCommissionDefaut: input.tauxCommissionDefaut }),
    })
    .where(eq(schema.sousDistributeur.idApporteur, idApporteur))
    .returning()
    .get();
}
