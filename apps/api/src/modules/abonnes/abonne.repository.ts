import { and, eq, like, or } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface AbonneInput {
  siteId: number;
  nom: string;
  prenom: string;
  telephone: string;
  email?: string;
  numeroCni?: string;
  adresse?: string;
  apporteurId?: number;
}

export function creerAbonne(db: Db, input: AbonneInput) {
  return db
    .insert(schema.abonne)
    .values({
      siteId: input.siteId,
      nom: input.nom,
      prenom: input.prenom,
      telephone: input.telephone,
      email: input.email,
      numeroCni: input.numeroCni,
      adresse: input.adresse,
      apporteurId: input.apporteurId,
    })
    .returning()
    .get();
}

export function trouverAbonne(db: Db, idAbonne: number) {
  return db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, idAbonne)).get();
}

export interface ModifierAbonneInput {
  nom?: string;
  prenom?: string;
  telephone?: string;
  email?: string;
  numeroCni?: string;
  adresse?: string;
}

// 8.1 : modification de fiche abonné — l'apporteur d'affaires n'est jamais
// modifiable ici, il est permanent une fois renseigné à la création (6.3)
export function modifierAbonne(db: Db, idAbonne: number, input: ModifierAbonneInput) {
  const existant = trouverAbonne(db, idAbonne);
  if (!existant) throw new Error(`Abonné ${idAbonne} introuvable`);

  return db
    .update(schema.abonne)
    .set({
      nom: input.nom ?? existant.nom,
      prenom: input.prenom ?? existant.prenom,
      telephone: input.telephone ?? existant.telephone,
      email: input.email ?? existant.email,
      numeroCni: input.numeroCni ?? existant.numeroCni,
      adresse: input.adresse ?? existant.adresse,
    })
    .where(eq(schema.abonne.idAbonne, idAbonne))
    .returning()
    .get();
}

// 4.5 : recherche unifiée par numéro d'abonné, numéro d'abonnement en cours,
// nom/prénom ou téléphone — résolution unique vers la fiche ABONNE.
export function rechercherAbonnes(db: Db, siteId: number, terme: string) {
  const termeNumerique = /^\d+$/.test(terme) ? Number(terme) : null;

  if (termeNumerique !== null) {
    const parId = db
      .select()
      .from(schema.abonne)
      .where(and(eq(schema.abonne.siteId, siteId), eq(schema.abonne.idAbonne, termeNumerique)))
      .all();
    if (parId.length > 0) return parId;

    const parAbonnement = db
      .select({ abonne: schema.abonne })
      .from(schema.abonnement)
      .innerJoin(schema.abonne, eq(schema.abonnement.idAbonne, schema.abonne.idAbonne))
      .where(and(eq(schema.abonne.siteId, siteId), eq(schema.abonnement.numeroAbonnement, termeNumerique)))
      .all();
    if (parAbonnement.length > 0) return parAbonnement.map((r) => r.abonne);
  }

  const motif = `%${terme}%`;
  return db
    .select()
    .from(schema.abonne)
    .where(
      and(
        eq(schema.abonne.siteId, siteId),
        or(
          like(schema.abonne.nom, motif),
          like(schema.abonne.prenom, motif),
          like(schema.abonne.telephone, motif)
        )
      )
    )
    .all();
}
