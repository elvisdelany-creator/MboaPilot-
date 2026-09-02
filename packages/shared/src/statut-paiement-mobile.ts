export type StatutPaiementMobile = "INITIEE" | "EN_ATTENTE" | "REUSSIE" | "ECHOUEE" | "EXPIREE";

const TRANSITIONS: Record<StatutPaiementMobile, StatutPaiementMobile[]> = {
  INITIEE: ["EN_ATTENTE", "ECHOUEE"],
  EN_ATTENTE: ["REUSSIE", "ECHOUEE", "EXPIREE"],
  REUSSIE: [],
  ECHOUEE: [],
  EXPIREE: [],
};

// 6.6 : cycle de vie d'une transaction de paiement mobile (Orange Money et
// extensible) — REUSSIE/ECHOUEE/EXPIREE sont des états terminaux.
export function peutTransitionnerPaiementMobile(actuel: StatutPaiementMobile, cible: StatutPaiementMobile): boolean {
  return TRANSITIONS[actuel].includes(cible);
}
