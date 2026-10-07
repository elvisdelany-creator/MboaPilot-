import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface JournalAuditFiltre {
  tableCible?: string;
}

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

  const conditions = filtre.tableCible ? [eq(schema.journalAudit.tableCible, filtre.tableCible)] : [];
  return (conditions.length > 0 ? requete.where(and(...conditions)) : requete).all();
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
