import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { validerMotDePasse } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverPolitiqueMotDePasseParSite } from "../entreprise/entreprise.repository.js";

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

// 2.5.1, 11.2 : mot de passe haché (bcrypt), jamais stocké ni journalisé en
// clair — validé contre la politique de complexité minimale configurée sur
// le site (8.8) avant tout hachage. 11.5 : "création... d'utilisateur" est une
// action sensible à journaliser (auteur nullable — fixtures de test, sans
// acteur humain identifié, sur le même modèle que le job automatique 11.3).
export function creerUtilisateur(db: Db, input: CreerUtilisateurInput, acteurId: number | null = null) {
  const politique = trouverPolitiqueMotDePasseParSite(db, input.siteId);
  const erreurs = validerMotDePasse(input.motDePasse, politique);
  if (erreurs.length > 0) throw new Error(erreurs.join(" — "));

  const motDePasseHash = bcrypt.hashSync(input.motDePasse, TOURS_HACHAGE);
  const utilisateur = db
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

  db.insert(schema.journalAudit)
    .values({
      utilisateurId: acteurId,
      action: "CREATION",
      tableCible: "utilisateur",
      idCible: String(utilisateur.idUser),
      valeurApres: JSON.stringify({ siteId: utilisateur.siteId, identifiant: utilisateur.identifiant, role: utilisateur.role }),
    })
    .run();

  return utilisateur;
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
// (l'historique tracé par userId sur factures/abonnements/SAV doit rester valide).
// 11.5 : "désactivation d'utilisateur" est une action sensible à journaliser,
// avec la valeur avant/après (actif, rôle) et l'auteur du changement.
export function modifierUtilisateur(db: Db, idUser: number, input: ModifierUtilisateurInput, acteurId: number | null = null) {
  const avant = db.select(COLONNES_SANS_HASH).from(schema.utilisateur).where(eq(schema.utilisateur.idUser, idUser)).get();
  if (!avant) return undefined;

  const apres = db
    .update(schema.utilisateur)
    .set({
      ...(input.actif !== undefined && { actif: input.actif ? 1 : 0 }),
      ...(input.role !== undefined && { role: input.role }),
    })
    .where(eq(schema.utilisateur.idUser, idUser))
    .returning(COLONNES_SANS_HASH)
    .get();

  db.insert(schema.journalAudit)
    .values({
      utilisateurId: acteurId,
      action: "MODIFICATION",
      tableCible: "utilisateur",
      idCible: String(idUser),
      valeurAvant: JSON.stringify({ actif: avant.actif, role: avant.role }),
      valeurApres: JSON.stringify({ actif: apres?.actif, role: apres?.role }),
    })
    .run();

  return apres;
}
