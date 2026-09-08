import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { chiffrer, dechiffrer } from "../../config/chiffrement.js";

export interface CreerComptePartageInput {
  siteId: number;
  idFamille: number;
  libelle: string;
  identifiant?: string;
  motDePasse?: string;
  nombreEcransMax: number;
}

// 11.2 : déchiffre à la lecture un compte tel que stocké en base (identifiant
// et mot de passe chiffrés au repos, 5.9) — la visibilité de la valeur en
// clair reste par ailleurs restreinte au niveau des routes aux rôles de vente.
function dechiffrerCompte<T extends { identifiant: string | null; motDePasse: string | null }>(compte: T): T {
  return {
    ...compte,
    identifiant: compte.identifiant !== null ? dechiffrer(compte.identifiant) : null,
    motDePasse: compte.motDePasse !== null ? dechiffrer(compte.motDePasse) : null,
  };
}

// 5.9, 11.2 : compte fournisseur mutualisé (Netflix, Prime Vidéo, IPTV…) —
// identifiant et mot de passe chiffrés au repos (chiffrement.ts) ; la
// visibilité en clair reste restreinte au niveau des routes aux rôles de vente.
export function creerComptePartage(db: Db, input: CreerComptePartageInput) {
  const compte = db
    .insert(schema.comptePartageStreaming)
    .values({
      siteId: input.siteId,
      idFamille: input.idFamille,
      libelle: input.libelle,
      identifiant: input.identifiant !== undefined ? chiffrer(input.identifiant) : undefined,
      motDePasse: input.motDePasse !== undefined ? chiffrer(input.motDePasse) : undefined,
      nombreEcransMax: input.nombreEcransMax,
    })
    .returning()
    .get();
  return dechiffrerCompte(compte);
}

export function trouverComptePartage(db: Db, idComptePartage: number) {
  const compte = db.select().from(schema.comptePartageStreaming).where(eq(schema.comptePartageStreaming.idComptePartage, idComptePartage)).get();
  return compte ? dechiffrerCompte(compte) : undefined;
}

// un écran se libère dès que l'abonnement individuel qui l'occupait n'est
// plus ACTIF (expiration ou résiliation) — pas de libération manuelle à prévoir
export function compterEcransOccupes(db: Db, idComptePartage: number) {
  return db
    .select()
    .from(schema.abonnement)
    .where(and(eq(schema.abonnement.idComptePartage, idComptePartage), eq(schema.abonnement.statut, "ACTIF")))
    .all().length;
}

export type ComptePartageAvecOccupation = NonNullable<ReturnType<typeof trouverComptePartage>> & { ecransOccupes: number };

export function listerComptesPartages(db: Db, siteId: number) {
  const comptes = db.select().from(schema.comptePartageStreaming).where(eq(schema.comptePartageStreaming.siteId, siteId)).all();
  return comptes.map((compte) => ({ ...dechiffrerCompte(compte), ecransOccupes: compterEcransOccupes(db, compte.idComptePartage) }));
}

export interface ModifierComptePartageInput {
  libelle?: string;
  identifiant?: string;
  motDePasse?: string;
  nombreEcransMax?: number;
  actif?: boolean;
}

export function modifierComptePartage(db: Db, idComptePartage: number, input: ModifierComptePartageInput) {
  const compte = db
    .update(schema.comptePartageStreaming)
    .set({
      ...(input.libelle !== undefined && { libelle: input.libelle }),
      ...(input.identifiant !== undefined && { identifiant: chiffrer(input.identifiant) }),
      ...(input.motDePasse !== undefined && { motDePasse: chiffrer(input.motDePasse) }),
      ...(input.nombreEcransMax !== undefined && { nombreEcransMax: input.nombreEcransMax }),
      ...(input.actif !== undefined && { actif: input.actif ? 1 : 0 }),
    })
    .where(eq(schema.comptePartageStreaming.idComptePartage, idComptePartage))
    .returning()
    .get();
  return compte ? dechiffrerCompte(compte) : undefined;
}

// 5.9 : fiche du compte partagé — occupants actuels (tous statuts, pour
// distinguer d'un coup d'œil qui occupe encore un écran ACTIF de qui a déjà libéré le sien)
export function construireFicheComptePartage(db: Db, idComptePartage: number) {
  const compte = trouverComptePartage(db, idComptePartage);
  if (!compte) return undefined;

  const abonnements = db.select().from(schema.abonnement).where(eq(schema.abonnement.idComptePartage, idComptePartage)).all();
  const occupants = abonnements.map((abonnement) => {
    const abonne = db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, abonnement.idAbonne)).get()!;
    return { numeroAbonnement: abonnement.numeroAbonnement, statut: abonnement.statut, dateFin: abonnement.dateFin, abonne };
  });

  return { compte, occupants };
}
