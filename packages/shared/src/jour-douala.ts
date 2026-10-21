import { lireDateServeur } from "./date-serveur.js";

// Le « jour » d'une boutique est celui de Douala : UTC+1 toute l'année (le Cameroun n'a pas de changement d'heure). Compter les
// jours en UTC faisait vivre l'application « la veille » entre minuit et 1 h du matin : un abonnement vendu à 00h30 démarrait un
// jour trop tôt (et expirait un jour trop tôt), et la vente était comptée dans le chiffre d'affaires de la veille.
// SQLite enregistre les horodatages en UTC (« 2026-10-20 23:30:00 ») : on convertit à la lecture, jamais dans la base.
const DECALAGE_DOUALA_MS = 60 * 60 * 1000;
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

// jour AAAA-MM-JJ à Douala d'un instant : un Date, un horodatage SQLite (UTC sans fuseau) ou une date ISO ; maintenant par défaut
export function jourDouala(instant: Date | string = new Date()): string {
  const date = typeof instant === "string" ? lireDateServeur(instant) : instant;
  return new Date(date.getTime() + DECALAGE_DOUALA_MS).toISOString().slice(0, 10);
}

function horodatageSqlite(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

// plage UTC, au format des horodatages SQLite, qui couvre le jour J de Douala : [debut, fin[ — la comparaison de textes
// fonctionne directement sur les colonnes date_creation / date_paiement
export function bornesJourDouala(jour: string): { debut: string; fin: string } {
  const minuitDouala = Date.parse(`${jour}T00:00:00Z`) - DECALAGE_DOUALA_MS;
  return { debut: horodatageSqlite(new Date(minuitDouala)), fin: horodatageSqlite(new Date(minuitDouala + MS_PAR_JOUR)) };
}
