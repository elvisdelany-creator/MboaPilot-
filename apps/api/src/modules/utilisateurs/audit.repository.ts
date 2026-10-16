import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface JournalAuditFiltre {
  tableCible?: string;
  limite?: number; // 200 par défaut, 1 000 au maximum
  avantId?: number; // curseur : uniquement les entrées plus anciennes que celle-ci
}

const LIMITE_PAR_DEFAUT = 200;
const LIMITE_MAX = 1000;

// 11.5, 8.7 : journal d'audit consultable, le plus récent en tête, avec
// l'identité de l'auteur — la table journal_audit elle-même est immuable
// (jamais de UPDATE/DELETE applicatif), cette fonction ne fait que la lire.
// Jointure gauche, jamais interne : une action système (job quotidien —
// anonymisation automatique 11.3, expiration d'abonnement) journalise avec
// utilisateur_id NULL, et une jointure interne exclurait silencieusement
// ces entrées, cachant précisément les actions les plus sensibles à tracer.
export function listerJournalAudit(db: Db, filtre: JournalAuditFiltre = {}) {
  const requete = db
    .select({
      idAudit: schema.journalAudit.idAudit,
      utilisateurId: schema.journalAudit.utilisateurId,
      utilisateurNom: schema.utilisateur.nom,
      utilisateurPrenom: schema.utilisateur.prenom,
      action: schema.journalAudit.action,
      tableCible: schema.journalAudit.tableCible,
      idCible: schema.journalAudit.idCible,
      valeurAvant: schema.journalAudit.valeurAvant,
      valeurApres: schema.journalAudit.valeurApres,
      dateAction: schema.journalAudit.dateAction,
    })
    .from(schema.journalAudit)
    .leftJoin(schema.utilisateur, eq(schema.journalAudit.utilisateurId, schema.utilisateur.idUser))
    .orderBy(desc(schema.journalAudit.idAudit));

  // la liste n'était pas bornée : 51 Mo de JSON et 100 000 lignes à afficher avec 100 000 entrées
  if (filtre.limite !== undefined && (!Number.isSafeInteger(filtre.limite) || filtre.limite < 1)) throw new Error("La limite du journal d'audit doit être un entier d'au moins 1");
  if (filtre.avantId !== undefined && !Number.isSafeInteger(filtre.avantId)) throw new Error("Le curseur avantId du journal d'audit doit être un entier");
  const limite = Math.min(filtre.limite ?? LIMITE_PAR_DEFAUT, LIMITE_MAX);

  const conditions = [];
  if (filtre.tableCible) conditions.push(eq(schema.journalAudit.tableCible, filtre.tableCible));
  if (filtre.avantId !== undefined) conditions.push(lt(schema.journalAudit.idAudit, filtre.avantId));
  return (conditions.length > 0 ? requete.where(and(...conditions)) : requete).limit(limite).all();
}

export type ActionAudit = "CREATION" | "MODIFICATION" | "SUPPRESSION";

// 11.5 : écrit une ligne immuable du journal d'audit (auteur, horodatage, valeurs
// avant/après). `acteurId` null = action système.
export function journaliserAudit(
  db: Db,
  params: { acteurId: number | null; action: ActionAudit; tableCible: string; idCible: string | number; avant?: unknown; apres?: unknown }
): void {
  db.insert(schema.journalAudit)
    .values({
      utilisateurId: params.acteurId,
      action: params.action,
      tableCible: params.tableCible,
      idCible: String(params.idCible),
      ...(params.avant !== undefined && { valeurAvant: JSON.stringify(params.avant) }),
      ...(params.apres !== undefined && { valeurApres: JSON.stringify(params.apres) }),
    })
    .run();
}

// Champs réellement modifiés entre deux états : null quand rien ne change, pour ne
// pas polluer le journal avec des « modifications » identiques.
export function differencesAudit(
  avant: Record<string, unknown>,
  apres: Record<string, unknown>,
  champs: readonly string[]
): { avant: Record<string, unknown>; apres: Record<string, unknown> } | null {
  const diffAvant: Record<string, unknown> = {};
  const diffApres: Record<string, unknown> = {};
  for (const champ of champs) {
    if (!Object.is(avant[champ], apres[champ])) {
      diffAvant[champ] = avant[champ];
      diffApres[champ] = apres[champ];
    }
  }
  return Object.keys(diffAvant).length > 0 ? { avant: diffAvant, apres: diffApres } : null;
}
