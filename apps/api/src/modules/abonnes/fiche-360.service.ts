import { eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverAbonne } from "./abonne.repository.js";

export interface AbonnementAvecFormule {
  numeroAbonnement: number;
  idFormule: number;
  formuleLibelle: string;
  familleLibelle: string;
  dateDebut: string;
  dateFin: string;
  statut: "ACTIF" | "EXPIRE" | "RESILIE";
}

export interface Fiche360 {
  abonne: NonNullable<ReturnType<typeof trouverAbonne>>;
  apporteur: typeof schema.sousDistributeur.$inferSelect | null;
  abonnements: AbonnementAvecFormule[];
  materiels: (typeof schema.materielAbonne.$inferSelect)[];
  factures: (typeof schema.facture.$inferSelect)[];
  dossiersSav: (typeof schema.savDossier.$inferSelect)[];
}

// 8.1 : fiche « 360° » — coordonnées, historique complet des abonnements
// (toutes familles confondues), matériel installé, factures, dossiers SAV
// et apporteur d'affaires éventuel, consolidés en une seule vue.
export function construireFiche360(db: Db, idAbonne: number): Fiche360 {
  const abonne = trouverAbonne(db, idAbonne);
  if (!abonne) throw new Error(`Abonné ${idAbonne} introuvable`);

  const apporteur = abonne.apporteurId
    ? (db.select().from(schema.sousDistributeur).where(eq(schema.sousDistributeur.idApporteur, abonne.apporteurId)).get() ?? null)
    : null;

  const abonnements = db
    .select({
      numeroAbonnement: schema.abonnement.numeroAbonnement,
      idFormule: schema.abonnement.idFormule,
      formuleLibelle: schema.formule.libelle,
      familleLibelle: schema.familleAbonnement.libelle,
      dateDebut: schema.abonnement.dateDebut,
      dateFin: schema.abonnement.dateFin,
      statut: schema.abonnement.statut,
    })
    .from(schema.abonnement)
    .innerJoin(schema.formule, eq(schema.abonnement.idFormule, schema.formule.idFormule))
    .innerJoin(schema.familleAbonnement, eq(schema.formule.idFamille, schema.familleAbonnement.idFamille))
    .where(eq(schema.abonnement.idAbonne, idAbonne))
    .all();

  const numerosAbonnement = abonnements.map((a) => a.numeroAbonnement);
  const materiels =
    numerosAbonnement.length > 0
      ? db.select().from(schema.materielAbonne).where(inArray(schema.materielAbonne.numeroAbonnement, numerosAbonnement)).all()
      : [];

  const factures = db.select().from(schema.facture).where(eq(schema.facture.idAbonne, idAbonne)).all();
  const dossiersSav = db.select().from(schema.savDossier).where(eq(schema.savDossier.idAbonne, idAbonne)).all();

  return { abonne, apporteur, abonnements, materiels, factures, dossiersSav };
}
