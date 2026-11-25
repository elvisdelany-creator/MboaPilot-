import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DELAI_GRACE_LICENCE_JOURS, joursAvantEcheance } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { lireCle, PALIERS_LICENCE } from "./cle-renouvellement.js";

export const DELAI_GRACE_JOURS = DELAI_GRACE_LICENCE_JOURS;
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
  // jours avant l'échéance de l'abonnement éditeur : négatif une fois dépassée (l'application est alors en lecture seule)
  joursRestantsAbonnement: number;
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
    joursRestantsAbonnement: joursAvantEcheance(licence.dateExpirationAbonnement.slice(0, 10), aujourdHui),
  };
}

const DUREE_MAX_PROLONGATION_JOURS = 3653; // 10 ans

// « AAAA-MM-JJ » existant au calendrier (ni 2028-13-40, ni 2028-02-30)
function estDateIsoReelle(valeur: unknown): valeur is string {
  if (typeof valeur !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false;
  const date = new Date(valeur + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === valeur;
}

export interface AppliquerCleParams {
  cle: string;
  clePublique: string; // celle de l'éditeur, inscrite dans l'application
  userId: number;
  maintenant?: string;
}

// 10.4 : renouvellement par clé signée de l'éditeur. La clé doit viser cette installation, couvrir au-delà d'aujourd'hui et de l'échéance
// actuelle (une ancienne clé rejouée ne fait rien). Elle fixe l'échéance et la formule, et revalide la licence. Tracée dans le journal.
export function appliquerCleRenouvellement(db: Db, params: AppliquerCleParams): typeof schema.licence.$inferSelect {
  const maintenant = params.maintenant ?? new Date().toISOString();
  const { installation, expiration, palier } = lireCle(params.cle, params.clePublique);

  const licence = obtenirOuCreerLicence(db, maintenant);
  if (installation !== licence.empreinteInstallation) {
    throw new Error(`Cette clé a été émise pour une autre installation. Donnez à l'éditeur l'identifiant de celle-ci : ${licence.empreinteInstallation}`);
  }
  if (!estDateIsoReelle(expiration)) throw new Error("La date d'échéance portée par la clé est invalide : demandez-en une nouvelle");
  if (!(PALIERS_LICENCE as readonly string[]).includes(palier)) throw new Error(`La formule « ${palier} » portée par la clé est inconnue de cette version : mettez l'application à jour`);
  const aujourdHui = maintenant.slice(0, 10);
  const actuelle = licence.dateExpirationAbonnement.slice(0, 10);
  if (expiration <= aujourdHui) throw new Error(`Cette clé est déjà expirée (échéance ${expiration}) : demandez-en une nouvelle`);
  if (expiration <= actuelle) throw new Error(`Cette clé ne prolonge pas l'abonnement : elle s'arrête au ${expiration}, l'échéance actuelle est le ${actuelle}`);
  if (expiration > ajouterJours(aujourdHui, DUREE_MAX_PROLONGATION_JOURS)) throw new Error("La clé dépasse 10 ans : demandez-en une nouvelle");

  return enregistrerEcheance(db, { licence, userId: params.userId, maintenant, valeurs: { dateExpirationAbonnement: expiration, palier } });
}

// nouvelle échéance, revalidation et trace d'audit s'écrivent ensemble
function enregistrerEcheance(
  db: Db,
  p: { licence: typeof schema.licence.$inferSelect; userId: number; maintenant: string; valeurs: { dateExpirationAbonnement: string; palier?: string } },
) {
  return db.transaction(() => {
    const apres = db
      .update(schema.licence)
      .set({ ...p.valeurs, derniereRevalidationReussie: p.maintenant })
      .where(eq(schema.licence.idLicence, p.licence.idLicence))
      .returning()
      .get();
    db.insert(schema.journalAudit)
      .values({
        utilisateurId: p.userId,
        action: "MODIFICATION",
        tableCible: "licence",
        idCible: String(p.licence.idLicence),
        valeurAvant: JSON.stringify({ dateExpirationAbonnement: p.licence.dateExpirationAbonnement.slice(0, 10), ...(p.valeurs.palier !== undefined && { palier: p.licence.palier }) }),
        valeurApres: JSON.stringify(p.valeurs),
      })
      .run();
    return apres;
  });
}

export interface ProlongerLicenceParams {
  dateExpiration: string;
  userId: number;
  maintenant?: string;
}

// Pilote : l'administrateur saisit la nouvelle échéance de l'abonnement (date et non clé signée : aucun contrôle éditeur
// à ce stade). Elle doit prolonger, c'est-à-dire dépasser à la fois aujourd'hui et l'échéance actuelle, sans excéder
// 10 ans (une faute de frappe sur l'année ne doit pas rendre la licence éternelle). Elle revalide aussi la licence :
// sinon un poste resté hors ligne au-delà du délai de grâce serait toujours en lecture seule. Tracée dans le journal.
export function prolongerLicence(db: Db, params: ProlongerLicenceParams): typeof schema.licence.$inferSelect {
  const maintenant = params.maintenant ?? new Date().toISOString();
  const date = params.dateExpiration;
  if (!estDateIsoReelle(date)) throw new Error("La date d'expiration est invalide : saisissez une date réelle au format AAAA-MM-JJ");

  const licence = obtenirOuCreerLicence(db, maintenant);
  const aujourdHui = maintenant.slice(0, 10);
  const actuelle = licence.dateExpirationAbonnement.slice(0, 10);
  if (date <= aujourdHui) throw new Error("La nouvelle date d'expiration doit être postérieure à aujourd'hui");
  if (date <= actuelle) throw new Error(`La nouvelle date doit prolonger l'abonnement : elle doit dépasser l'échéance actuelle (${actuelle})`);
  if (date > ajouterJours(aujourdHui, DUREE_MAX_PROLONGATION_JOURS)) throw new Error("La nouvelle date d'expiration ne peut pas dépasser 10 ans");

  return enregistrerEcheance(db, { licence, userId: params.userId, maintenant, valeurs: { dateExpirationAbonnement: date } });
}
