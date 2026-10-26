import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { texteObligatoire } from "../../lib/champs-texte.js";

export interface ResilierAbonnementParams {
  numeroAbonnement: number;
  userId: number;
  // horloge injectée : décide si la résiliation tombe pendant la période probatoire de la commission (6.2)
  aujourdHui: string;
  motif: string; // ex. demande du client, litige, matériel non restitué (4.3)
}

export interface ResiliationResultat {
  numeroAbonnement: number;
  // le suivi de commission CANAL+ en cours a été annulé (résiliation pendant la période probatoire)
  commissionAnnulee: boolean;
}

// 4.3 : « ACTIF → RESILIE (action manuelle) — action explicite d'un utilisateur habilité (demande du client, litige, matériel non
// restitué) ». État terminal : seul un nouveau recrutement (nouveau numéro) peut suivre. Le statut était lu partout (fiche client,
// réabonnement, caisse) mais aucune action ne pouvait le produire.
export function resilierAbonnement(db: Db, params: ResilierAbonnementParams): ResiliationResultat {
  const motif = texteObligatoire(params.motif, "Le motif de la résiliation", 200);
  // atomique : le statut, l'historique et le suivi de commission changent ensemble
  return db.transaction(() => {
    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, params.numeroAbonnement)).get();
    if (!abonnement) throw new Error(`Abonnement ${params.numeroAbonnement} introuvable`);
    if (abonnement.statut === "RESILIE") throw new Error("Cet abonnement est déjà résilié");
    // seul un abonnement ACTIF se résilie (4.3) ; un abonnement expiré n'a plus rien à résilier. Un abonnement dont la date de fin
    // est passée mais que le job quotidien n'a pas encore basculé reste ACTIF, donc résiliable.
    if (abonnement.statut === "EXPIRE") throw new Error("Cet abonnement a déjà expiré : il n'y a rien à résilier");

    db.update(schema.abonnement).set({ statut: "RESILIE" }).where(eq(schema.abonnement.numeroAbonnement, params.numeroAbonnement)).run();
    db.insert(schema.historiqueAbonnement)
      .values({
        numeroAbonnement: params.numeroAbonnement,
        typeChangement: "STATUT",
        valeurAvant: abonnement.statut,
        valeurApres: "RESILIE",
        motif: `resiliation : ${motif}`,
        utilisateurId: params.userId,
      })
      .run();

    // 6.2.3 : un client qui part « à un moment quelconque de la période probatoire » fait perdre la commission ; passé ce délai,
    // elle est acquise. Réglée ici plutôt que par le job, qui ne confond pas résiliation et expiration.
    let commissionAnnulee = false;
    const suivis = db
      .select()
      .from(schema.suiviCommissionCanalplus)
      .where(and(eq(schema.suiviCommissionCanalplus.numeroAbonnement, params.numeroAbonnement), eq(schema.suiviCommissionCanalplus.statut, "EN_COURS")))
      .all();
    for (const suivi of suivis) {
      const duePendantLaProbation = params.aujourdHui <= suivi.dateFinProbatoire;
      db.update(schema.suiviCommissionCanalplus)
        .set({ statut: duePendantLaProbation ? "ANNULEE" : "CONFIRMEE" })
        .where(eq(schema.suiviCommissionCanalplus.idSuivi, suivi.idSuivi))
        .run();
      if (duePendantLaProbation) commissionAnnulee = true;
    }

    return { numeroAbonnement: params.numeroAbonnement, commissionAnnulee };
  });
}
