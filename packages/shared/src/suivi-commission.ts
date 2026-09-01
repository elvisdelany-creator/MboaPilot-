import type { StatutAbonnement } from "./statut-abonnement.js";

export type StatutCommission = "EN_COURS" | "CONFIRMEE" | "ANNULEE";

// 6.2 : job quotidien d'évaluation du suivi de commission CANAL+ sur 4 mois.
// CONFIRMEE/ANNULEE sont des états terminaux, jamais réévalués.
export function evaluerSuiviCommission(
  statutSuivi: StatutCommission,
  statutAbonnementCourant: StatutAbonnement,
  dateFinProbatoire: string,
  aujourdHui: string
): StatutCommission {
  if (statutSuivi !== "EN_COURS") return statutSuivi;

  if (statutAbonnementCourant === "EXPIRE" && aujourdHui <= dateFinProbatoire) return "ANNULEE";
  if (aujourdHui > dateFinProbatoire) return "CONFIRMEE";
  return "EN_COURS";
}
