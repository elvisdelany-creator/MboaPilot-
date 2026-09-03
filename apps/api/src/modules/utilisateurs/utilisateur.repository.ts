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
  idApporteur?: number; // requis en pratique pour un compte de rôle APPORTEUR (2.5.1, 6.3)
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
      idApporteur: input.idApporteur,
    })
    .returning()
    .get();
}

export function trouverUtilisateurParIdentifiant(db: Db, identifiant: string) {
  return db.select().from(schema.utilisateur).where(eq(schema.utilisateur.identifiant, identifiant)).get();
}

const COLONNES_SANS_HASH = {
  idUser: schema.utilisateur.idUser,
  siteId: schema.utilisateur.siteId,
  nom: schema.utilisateur.nom,
  prenom: schema.utilisateur.prenom,
  identifiant: schema.utilisateur.identifiant,
  role: schema.utilisateur.role,
  idApporteur: schema.utilisateur.idApporteur,
  actif: schema.utilisateur.actif,
  dateCreation: schema.utilisateur.dateCreation,
};

// 8.7 : comptes du site, actifs et inactifs (une désactivation reste
// consultable — ce n'est pas une suppression), jamais le hash du mot de passe
export function listerUtilisateurs(db: Db, siteId: number) {
  return db.select(COLONNES_SANS_HASH).from(schema.utilisateur).where(eq(schema.utilisateur.siteId, siteId)).all();
}

export interface ModifierUtilisateurInput {
  actif?: boolean;
  role?: Role;
}

// 8.7 : désactivation de compte et changement de rôle — jamais de suppression
// (l'historique tracé par userId sur factures/abonnements/SAV doit rester valide)
export function modifierUtilisateur(db: Db, idUser: number, input: ModifierUtilisateurInput) {
  return db
    .update(schema.utilisateur)
    .set({
      ...(input.actif !== undefined && { actif: input.actif ? 1 : 0 }),
      ...(input.role !== undefined && { role: input.role }),
    })
    .where(eq(schema.utilisateur.idUser, idUser))
    .returning(COLONNES_SANS_HASH)
    .get();
}
