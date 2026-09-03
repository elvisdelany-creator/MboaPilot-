import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface JournalAuditFiltre {
  tableCible?: string;
}

// 11.5, 8.7 : journal d'audit consultable, le plus récent en tête, avec
// l'identité de l'auteur — la table journal_audit elle-même est immuable
// (jamais de UPDATE/DELETE applicatif), cette fonction ne fait que la lire.
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
    .innerJoin(schema.utilisateur, eq(schema.journalAudit.utilisateurId, schema.utilisateur.idUser))
    .orderBy(desc(schema.journalAudit.idAudit));

  const conditions = filtre.tableCible ? [eq(schema.journalAudit.tableCible, filtre.tableCible)] : [];
  return (conditions.length > 0 ? requete.where(and(...conditions)) : requete).all();
}
