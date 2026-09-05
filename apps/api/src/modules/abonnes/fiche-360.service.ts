import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverAbonne } from "./abonne.repository.js";
import { listerNotificationsAbonne } from "../notifications/notification.service.js";

export interface AbonnementAvecFormule {
  numeroAbonnement: number;
  idFormule: number;
  idFamille: number;
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
  paiements: (typeof schema.paiement.$inferSelect)[];
  dossiersSav: (typeof schema.savDossier.$inferSelect)[];
  commissionsCanalplus: (typeof schema.suiviCommissionCanalplus.$inferSelect)[];
  notifications: (typeof schema.notification.$inferSelect)[];
}

// 8.1, 9.4 : fiche « 360° » — coordonnées, historique complet des
// abonnements (toutes familles confondues), matériel installé, factures et
// leurs paiements (solde éventuel), dossiers SAV, suivi commission CANAL+,
// notifications envoyées (4.4, 8.3, 8.4) et apporteur d'affaires éventuel,
// consolidés en une seule vue.
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
      idFamille: schema.formule.idFamille,
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

  // 9.4 : la plus récente en tête, pour repérer d'un coup d'œil ce qui reste à encaisser
  const factures = db.select().from(schema.facture).where(eq(schema.facture.idAbonne, idAbonne)).orderBy(desc(schema.facture.idFacture)).all();
  const idsFactures = factures.map((f) => f.idFacture);
  const paiements = idsFactures.length > 0 ? db.select().from(schema.paiement).where(inArray(schema.paiement.idFacture, idsFactures)).all() : [];

  const dossiersSav = db.select().from(schema.savDossier).where(eq(schema.savDossier.idAbonne, idAbonne)).all();

  const commissionsCanalplus =
    numerosAbonnement.length > 0
      ? db.select().from(schema.suiviCommissionCanalplus).where(inArray(schema.suiviCommissionCanalplus.numeroAbonnement, numerosAbonnement)).all()
      : [];

  const notifications = listerNotificationsAbonne(db, idAbonne);

  return { abonne, apporteur, abonnements, materiels, factures, paiements, dossiersSav, commissionsCanalplus, notifications };
}
