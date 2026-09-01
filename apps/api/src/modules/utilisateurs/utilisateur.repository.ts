import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

const TOURS_HACHAGE = 12;

export type Role = "ADMINISTRATEUR" | "GERANT" | "CAISSIER" | "TECHNICIEN_SAV" | "COMPTABLE" | "APPORTEUR";

export interface CreerUtilisateurInput {
  siteId: number;
  nom: string;
  prenom: string;
  identifiant: string;
  motDePasse: string;
  role: Role;
}

// 2.5.1, 11.2 : mot de passe haché (bcrypt), jamais stocké ni journalisé en clair
export function creerUtilisateur(db: Db, input: CreerUtilisateurInput) {
  const motDePasseHash = bcrypt.hashSync(input.motDePasse, TOURS_HACHAGE);
  return db
    .insert(schema.utilisateur)
    .values({
      siteId: input.siteId,
      nom: input.nom,
      prenom: input.prenom,
      identifiant: input.identifiant,
      motDePasseHash,
      role: input.role,
    })
    .returning()
    .get();
}

export function trouverUtilisateurParIdentifiant(db: Db, identifiant: string) {
  return db.select().from(schema.utilisateur).where(eq(schema.utilisateur.identifiant, identifiant)).get();
}
