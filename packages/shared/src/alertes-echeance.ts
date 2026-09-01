export type JalonAlerte = "J-7" | "J-3" | "J-1";

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;
const JALONS: Record<number, JalonAlerte> = { 7: "J-7", 3: "J-3", 1: "J-1" };

// 9.3 : nombre de jours restants avant date_fin — négatif si déjà dépassée.
// Sert de base à la liste vivante des abonnements à échéance du tableau de
// bord, distincte du jalon ponctuel J-7/J-3/J-1 utilisé pour le journal d'alertes (4.4).
export function joursAvantEcheance(dateFin: string, aujourdHui: string): number {
  return Math.round((Date.parse(dateFin + "T00:00:00Z") - Date.parse(aujourdHui + "T00:00:00Z")) / MS_PAR_JOUR);
}

// 4.4 : jalon déclenché quand aujourd'hui tombe exactement à J-7, J-3 ou J-1
// avant date_fin d'un abonnement ACTIF.
export function detecterJalonAlerte(dateFin: string, aujourdHui: string): JalonAlerte | null {
  return JALONS[joursAvantEcheance(dateFin, aujourdHui)] ?? null;
}
