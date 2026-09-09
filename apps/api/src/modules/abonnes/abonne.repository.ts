import { and, eq, like, or } from "drizzle-orm";
import { joursAvantEcheance } from "@mboapilot/shared";
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

const PLACEHOLDER_NOM_ANONYMISE = "Anonymisé";

export interface AbonneEligibleAnonymisation {
  abonne: typeof schema.abonne.$inferSelect;
  derniereActivite: string; // date_fin du plus récent abonnement, ou date de création si aucun
}

// 11.3 : "durée de conservation définie et paramétrable, avec archivage ou
// anonymisation au-delà" — abonnés sans abonnement ACTIF, dont la dernière
// activité (date_fin du plus récent abonnement, ou création de la fiche si
// aucun abonnement) dépasse la durée de conservation configurée
// (entreprise.repository.ts). Les fiches déjà anonymisées sont ignorées
// pour ne pas les rejournaliser à chaque exécution du job quotidien.
export function listerAbonnesEligiblesAnonymisationAutomatique(
  db: Db,
  aujourdHui: string,
  dureeConservationJours: number
): AbonneEligibleAnonymisation[] {
  const abonnes = db.select().from(schema.abonne).all().filter((a) => a.nom !== PLACEHOLDER_NOM_ANONYMISE);

  return abonnes
    .map((abonne) => {
      const abonnements = db.select().from(schema.abonnement).where(eq(schema.abonnement.idAbonne, abonne.idAbonne)).all();
      const aUnAbonnementActif = abonnements.some((ab) => ab.statut === "ACTIF");
      const derniereActivite = abonnements.length > 0 ? abonnements.map((ab) => ab.dateFin).sort().at(-1)! : abonne.dateCreation.slice(0, 10);
      return { abonne, aUnAbonnementActif, derniereActivite };
    })
    .filter((a) => !a.aUnAbonnementActif)
    .filter((a) => -joursAvantEcheance(a.derniereActivite, aujourdHui) >= dureeConservationJours)
    .map(({ abonne, derniereActivite }) => ({ abonne, derniereActivite }));
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
