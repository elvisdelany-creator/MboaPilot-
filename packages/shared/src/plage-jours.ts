const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

// Jour ISO décalé de N jours (négatif = passé) — sert à borner une plage de
// dates dans une requête SQL (date >= jour AND date < jour suivant) au lieu de
// charger toute la table pour filtrer en mémoire.
export function decalerJour(jour: string, nombreJours: number): string {
  return new Date(Date.parse(jour + "T00:00:00Z") + nombreJours * MS_PAR_JOUR).toISOString().slice(0, 10);
}

// 9.3 : liste des N derniers jours (ISO, ordre croissant, borne "aujourd'hui"
// incluse) — sert d'axe temporel à la courbe d'évolution du chiffre d'affaires.
export function genererPlageJours(aujourdHui: string, nombreJours: number): string[] {
  const base = Date.parse(aujourdHui + "T00:00:00Z");
  const jours: string[] = [];
  for (let i = nombreJours - 1; i >= 0; i--) {
    jours.push(new Date(base - i * MS_PAR_JOUR).toISOString().slice(0, 10));
  }
  return jours;
}
