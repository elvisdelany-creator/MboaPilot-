import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface AnnulerPaiementParams {
  idPaiement: number;
  userId: number;
}

export interface AnnulerPaiementResultat {
  idFacture: number;
  totalPaye: number;
  statutFacture: "BROUILLON" | "VALIDEE";
}

// 9.1, 11.5 : "Aucune opération destructrice (suppression de vente,
// annulation de paiement) sans confirmation et sans traçabilité" — corrige
// un encaissement mal saisi (mauvais mode, mauvais montant), distinct de
// l'avoir (6.4) qui corrige les lignes d'une facture déjà vendue. Le
// paiement est retiré et journalisé (SUPPRESSION) ; la facture repasse
// BROUILLON si plus aucun encaissement ne subsiste.
export function annulerPaiement(db: Db, params: AnnulerPaiementParams): AnnulerPaiementResultat {
  const paiement = db.select().from(schema.paiement).where(eq(schema.paiement.idPaiement, params.idPaiement)).get();
  if (!paiement) throw new Error(`Paiement ${params.idPaiement} introuvable`);

  db.insert(schema.journalAudit)
    .values({
      utilisateurId: params.userId,
      action: "SUPPRESSION",
      tableCible: "paiement",
      idCible: String(params.idPaiement),
      valeurAvant: JSON.stringify(paiement),
    })
    .run();

  db.delete(schema.paiement).where(eq(schema.paiement.idPaiement, params.idPaiement)).run();

  const totalPaye =
    db
      .select({ total: sql<number>`coalesce(sum(${schema.paiement.montant}), 0)` })
      .from(schema.paiement)
      .where(eq(schema.paiement.idFacture, paiement.idFacture))
      .get()?.total ?? 0;

  let statutFacture: "BROUILLON" | "VALIDEE" = "VALIDEE";
  if (totalPaye === 0) {
    db.update(schema.facture).set({ statut: "BROUILLON" }).where(eq(schema.facture.idFacture, paiement.idFacture)).run();
    statutFacture = "BROUILLON";
  }

  return { idFacture: paiement.idFacture, totalPaye, statutFacture };
}
