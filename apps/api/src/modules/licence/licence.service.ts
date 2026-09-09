import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { joursAvantEcheance } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export const DELAI_GRACE_JOURS = 21;
const DUREE_ABONNEMENT_INITIAL_JOURS = 365;

export interface LicenceInfo {
  palier: string;
  empreinteInstallation: string;
  dateExpirationAbonnement: string;
  derniereRevalidationReussie: string;
}

export type EtatLicence = "ACTIVE" | "DEGRADE";

export interface StatutLicence extends LicenceInfo {
  etat: EtatLicence;
  joursRestantsGrace: number;
}

function ajouterJours(dateIso: string, jours: number): string {
  const date = new Date(dateIso + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + jours);
  return date.toISOString().slice(0, 10);
}

// 10.4 : "jeton de licence signé... stocké localement" — en l'absence de
// serveur de licence éditeur réel, une licence Essentiel par défaut est
// créée à la volée au premier accès (mode local zero-config, 2.2), avec une
// empreinte d'installation stable pour toute la durée de vie de la base.
export function obtenirOuCreerLicence(db: Db, maintenant: string): typeof schema.licence.$inferSelect {
  const existante = db.select().from(schema.licence).get();
  if (existante) return existante;

  const aujourdHui = maintenant.slice(0, 10);
  return db
    .insert(schema.licence)
    .values({
      empreinteInstallation: randomUUID(),
      dateExpirationAbonnement: ajouterJours(aujourdHui, DUREE_ABONNEMENT_INITIAL_JOURS),
      derniereRevalidationReussie: maintenant,
    })
    .returning()
    .get();
}

// 10.4 étape 2 : "tente une revalidation périodique... auprès du serveur de
// licence de l'éditeur, dès qu'une connexion Internet est disponible" — aucun
// serveur de licence réel n'existe à ce stade, la revalidation est simulée et
// réussit systématiquement (point d'extension pour un futur adaptateur réseau,
// sur le même modèle que le simulateur Orange Money, 6.6).
export function revaliderLicence(db: Db, maintenant: string): typeof schema.licence.$inferSelect {
  const licence = obtenirOuCreerLicence(db, maintenant);
  return db
    .update(schema.licence)
    .set({ derniereRevalidationReussie: maintenant })
    .where(eq(schema.licence.idLicence, licence.idLicence))
    .returning()
    .get();
}

// 10.3, 10.4 : un abonnement éditeur expiré, ou une revalidation périodique
// non réussie au-delà du délai de grâce hors ligne (21 j), bascule
// l'application en mode dégradé (lecture seule) — jamais de suppression de
// données, jamais de blocage brutal (10.3).
export function calculerEtatLicence(licence: LicenceInfo, maintenant: string): StatutLicence {
  const aujourdHui = maintenant.slice(0, 10);
  const joursDepuisRevalidation = -joursAvantEcheance(licence.derniereRevalidationReussie.slice(0, 10), aujourdHui);
  const joursRestantsGrace = DELAI_GRACE_JOURS - joursDepuisRevalidation;
  const abonnementExpire = joursAvantEcheance(licence.dateExpirationAbonnement.slice(0, 10), aujourdHui) < 0;

  return {
    ...licence,
    etat: abonnementExpire || joursRestantsGrace < 0 ? "DEGRADE" : "ACTIVE",
    joursRestantsGrace,
  };
}
