import type { StatutAbonnement } from "./statut-abonnement.js";

export type StatutCommission = "EN_COURS" | "CONFIRMEE" | "ANNULEE";

// 6.2 : job quotidien d'évaluation du suivi de commission CANAL+ sur 4 mois.
// CONFIRMEE/ANNULEE sont des états terminaux, jamais réévalués.
export function evaluerSuiviCommission(
  statutSuivi: StatutCommission,
  statutAbonnementCourant: StatutAbonnement,
  dateFinProbatoire: string,
  aujourdHui: string,
  dateFinAbonnement: string
): StatutCommission {
  if (statutSuivi !== "EN_COURS") return statutSuivi;

  // 6.2.3 : une expiration « à un moment quelconque de la période probatoire »
  // annule la commission, même constatée après celle-ci (job indisponible,
  // recrutement antidaté) — d'où la date de fin de validité de l'abonnement,
  // et pas seulement son statut au moment de l'évaluation.
  if (statutAbonnementCourant === "EXPIRE" && (aujourdHui <= dateFinProbatoire || dateFinAbonnement < dateFinProbatoire)) return "ANNULEE";
  if (aujourdHui > dateFinProbatoire) return "CONFIRMEE";
  return "EN_COURS";
}
