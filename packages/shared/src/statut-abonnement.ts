export type StatutAbonnement = "ACTIF" | "EXPIRE" | "RESILIE";

// job quotidien (4.3) : seul un abonnement ACTIF dont date_fin est dépassée
// bascule en EXPIRE. RESILIE est un état terminal (action manuelle) ; un
// abonnement déjà EXPIRE ne redevient ACTIF que via un réabonnement explicite.
export function evaluerExpiration(
  statutActuel: StatutAbonnement,
  dateFin: string,
  aujourdHui: string
): StatutAbonnement {
  if (statutActuel === "ACTIF" && aujourdHui > dateFin) {
    return "EXPIRE";
  }
  return statutActuel;
}
