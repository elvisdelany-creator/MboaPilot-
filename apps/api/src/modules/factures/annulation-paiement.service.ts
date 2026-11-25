import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { MESSAGE_MOBILE_CONFIRME, transactionMobileReussie } from "./paiement.repository.js";

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
  // atomique : le paiement était supprimé avant la mise à jour de la facture — un échec effaçait l'encaissement
  // tout en laissant la facture « VALIDEE »
  return db.transaction(() => annulerPaiementSansTransaction(db, params));
}

function annulerPaiementSansTransaction(db: Db, params: AnnulerPaiementParams): AnnulerPaiementResultat {
  const paiement = db.select().from(schema.paiement).where(eq(schema.paiement.idPaiement, params.idPaiement)).get();
  if (!paiement) throw new Error(`Paiement ${params.idPaiement} introuvable`);
  // 6.6 : un paiement confirmé par l'opérateur n'est pas une erreur de saisie — l'argent a quitté le compte du client. L'effacer permettait
  // ensuite d'annuler la vente, avec la trace de sa transaction. Il se corrige par un avoir et un remboursement.
  if (paiement.montant > 0 && paiement.referenceTransaction && transactionMobileReussie(db, paiement.idFacture, paiement.referenceTransaction)) {
    throw new Error(MESSAGE_MOBILE_CONFIRME);
  }

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

  const restant = db
    .select({ total: sql<number>`coalesce(sum(${schema.paiement.montant}), 0)`, nombre: sql<number>`count(*)` })
    .from(schema.paiement)
    .where(eq(schema.paiement.idFacture, paiement.idFacture))
    .get()!;
  const totalPaye = restant.total;
  // un encaissement déjà remboursé ne se retire pas seul : il resterait de l'argent sorti sans jamais être entré. L'erreur annule la
  // transaction entière, donc aussi la suppression et sa ligne d'audit.
  if (paiement.montant > 0 && totalPaye < 0) {
    throw new Error("Cet encaissement a fait l'objet d'un remboursement : annulez d'abord le remboursement, puis l'encaissement");
  }

  // « BROUILLON si plus aucun encaissement ne subsiste » : un encaissement et son remboursement qui s'annulent ne font pas un brouillon
  let statutFacture: "BROUILLON" | "VALIDEE" = "VALIDEE";
  if (restant.nombre === 0) {
    db.update(schema.facture).set({ statut: "BROUILLON" }).where(eq(schema.facture.idFacture, paiement.idFacture)).run();
    statutFacture = "BROUILLON";
  }

  return { idFacture: paiement.idFacture, totalPaye, statutFacture };
}
