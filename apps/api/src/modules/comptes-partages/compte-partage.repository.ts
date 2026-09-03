import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface CreerComptePartageInput {
  siteId: number;
  idFamille: number;
  libelle: string;
  identifiant?: string;
  motDePasse?: string;
  nombreEcransMax: number;
}

// 5.9 : compte fournisseur mutualisé (Netflix, Prime Vidéo, IPTV…) — identifiants
// stockés en clair (pas de coffre-fort de secrets en mode local, 2.2), la
// visibilité est restreinte au niveau des routes (11.2) aux rôles de vente.
export function creerComptePartage(db: Db, input: CreerComptePartageInput) {
  return db
    .insert(schema.comptePartageStreaming)
    .values({
      siteId: input.siteId,
      idFamille: input.idFamille,
      libelle: input.libelle,
      identifiant: input.identifiant,
      motDePasse: input.motDePasse,
      nombreEcransMax: input.nombreEcransMax,
    })
    .returning()
    .get();
}

export function trouverComptePartage(db: Db, idComptePartage: number) {
  return db.select().from(schema.comptePartageStreaming).where(eq(schema.comptePartageStreaming.idComptePartage, idComptePartage)).get();
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
  return comptes.map((compte) => ({ ...compte, ecransOccupes: compterEcransOccupes(db, compte.idComptePartage) }));
}

export interface ModifierComptePartageInput {
  libelle?: string;
  identifiant?: string;
  motDePasse?: string;
  nombreEcransMax?: number;
  actif?: boolean;
}

export function modifierComptePartage(db: Db, idComptePartage: number, input: ModifierComptePartageInput) {
  return db
    .update(schema.comptePartageStreaming)
    .set({
      ...(input.libelle !== undefined && { libelle: input.libelle }),
      ...(input.identifiant !== undefined && { identifiant: input.identifiant }),
      ...(input.motDePasse !== undefined && { motDePasse: input.motDePasse }),
      ...(input.nombreEcransMax !== undefined && { nombreEcransMax: input.nombreEcransMax }),
      ...(input.actif !== undefined && { actif: input.actif ? 1 : 0 }),
    })
    .where(eq(schema.comptePartageStreaming.idComptePartage, idComptePartage))
    .returning()
    .get();
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
