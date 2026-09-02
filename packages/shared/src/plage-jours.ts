const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

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
