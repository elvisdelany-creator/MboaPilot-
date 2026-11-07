// Premier et dernier jour (AAAA-MM-JJ) du mois du jour de référence, décalé de `decalage` mois (-1 = mois dernier). Calculé sur le
// calendrier, jamais sur des durées de 30 jours : le comptable clôture mois par mois.
export function periodeDuMois(jourReference: string, decalage = 0): { du: string; au: string } {
  const [annee, mois] = jourReference.split("-").map(Number);
  const premier = new Date(Date.UTC(annee, mois - 1 + decalage, 1));
  // le jour 0 du mois suivant est le dernier jour de celui-ci
  const dernier = new Date(Date.UTC(premier.getUTCFullYear(), premier.getUTCMonth() + 1, 0));
  return { du: premier.toISOString().slice(0, 10), au: dernier.toISOString().slice(0, 10) };
}
