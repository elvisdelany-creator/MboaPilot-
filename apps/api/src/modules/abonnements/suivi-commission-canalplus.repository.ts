import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface CreerSuiviCommissionParams {
  numeroAbonnement: number;
  vendeurId: number;
  apporteurId: number | undefined;
  montantCommission: number;
  dateFinProbatoire: string;
}

// 6.2 : "À la validation d'un recrutement CANAL+ (et uniquement un
// recrutement, pas un réabonnement)... le système crée automatiquement un
// enregistrement de suivi de commission" — point d'insertion unique, appelé
// au paiement immédiat (recrutement.service.ts) comme à la confirmation
// différée d'un paiement mobile (paiement-mobile.service.ts), toujours au
// moment exact où la facture devient réellement VALIDEE.
export function creerSuiviCommissionCanalplus(db: Db, params: CreerSuiviCommissionParams) {
  db.insert(schema.suiviCommissionCanalplus)
    .values({
      numeroAbonnement: params.numeroAbonnement,
      vendeurId: params.vendeurId,
      apporteurId: params.apporteurId,
      montantCommission: params.montantCommission,
      dateFinProbatoire: params.dateFinProbatoire,
    })
    .run();
}
