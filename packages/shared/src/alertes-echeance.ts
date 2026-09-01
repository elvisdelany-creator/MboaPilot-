export type JalonAlerte = "J-7" | "J-3" | "J-1";

const JALONS: Record<number, JalonAlerte> = { 7: "J-7", 3: "J-3", 1: "J-1" };

// 4.4 : jalon déclenché quand aujourd'hui tombe exactement à J-7, J-3 ou J-1
// avant date_fin d'un abonnement ACTIF.
export function detecterJalonAlerte(dateFin: string, aujourdHui: string): JalonAlerte | null {
  const msParJour = 24 * 60 * 60 * 1000;
  const diffJours = Math.round(
    (Date.parse(dateFin + "T00:00:00Z") - Date.parse(aujourdHui + "T00:00:00Z")) / msParJour
  );
  return JALONS[diffJours] ?? null;
}
