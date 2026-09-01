export type ModeDuree = "STRICT_30J" | "MOIS_CIVIL";

// ajoute N mois calendaires en clampant au dernier jour du mois cible quand
// il n'existe pas (ex. 31 janv. + 1 mois -> 28/29 fév., jamais 3 mars — 4.1)
function ajouterMoisCiviles(date: Date, n: number): Date {
  const jourOrigine = date.getUTCDate();
  const cible = new Date(date);
  cible.setUTCDate(1);
  cible.setUTCMonth(cible.getUTCMonth() + n);
  const dernierJourCible = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(jourOrigine, dernierJourCible));
  return cible;
}

// 4.1 : date_fin = date_debut + (duree_en_cycles_30j × 30) − 1 jour
// ou, en mode MOIS_CIVIL, date_debut + N mois calendaires − 1 jour
export function calculerDateFin(dateDebut: string, dureeCycles: number, modeDuree: ModeDuree): string {
  const debut = new Date(dateDebut + "T00:00:00Z");
  const fin = modeDuree === "MOIS_CIVIL" ? ajouterMoisCiviles(debut, dureeCycles) : new Date(debut);
  if (modeDuree === "STRICT_30J") {
    fin.setUTCDate(fin.getUTCDate() + dureeCycles * 30 - 1);
  } else {
    fin.setUTCDate(fin.getUTCDate() - 1);
  }
  return fin.toISOString().slice(0, 10);
}
