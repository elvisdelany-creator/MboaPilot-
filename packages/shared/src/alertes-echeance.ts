const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

// 4.4, 8.8 : seuils d'alerte, paramétrables (par défaut J-7/J-3/J-1) — rang 1
// est toujours le plus urgent, quels que soient les jours configurés, pour
// que l'affichage (couleur, tri) reste stable même si les seuils changent.
export interface JalonsAlerte {
  urgent: number; // ex. 1 jour
  modere: number; // ex. 3 jours
  anticipe: number; // ex. 7 jours
}

export const JALONS_PAR_DEFAUT: JalonsAlerte = { urgent: 1, modere: 3, anticipe: 7 };

export interface JalonDetecte {
  jours: number; // seuil configuré atteint (pas forcément le nombre de jours restants exact)
  rang: 1 | 2 | 3;
}

// 9.3 : nombre de jours restants avant date_fin — négatif si déjà dépassée.
// Sert de base à la liste vivante des abonnements à échéance du tableau de
// bord, distincte du jalon ponctuel utilisé pour le journal d'alertes (4.4).
export function joursAvantEcheance(dateFin: string, aujourdHui: string): number {
  return Math.round((Date.parse(dateFin + "T00:00:00Z") - Date.parse(aujourdHui + "T00:00:00Z")) / MS_PAR_JOUR);
}

// 4.4 : jalon déclenché quand aujourd'hui tombe exactement sur l'un des
// seuils configurés avant date_fin d'un abonnement ACTIF.
export function detecterJalonAlerte(dateFin: string, aujourdHui: string, jalons: JalonsAlerte = JALONS_PAR_DEFAUT): JalonDetecte | null {
  const jours = joursAvantEcheance(dateFin, aujourdHui);
  if (jours === jalons.urgent) return { jours: jalons.urgent, rang: 1 };
  if (jours === jalons.modere) return { jours: jalons.modere, rang: 2 };
  if (jours === jalons.anticipe) return { jours: jalons.anticipe, rang: 3 };
  return null;
}

// 9.3 : classe un nombre de jours restants dans la bande d'urgence la plus
// proche (contrairement à detecterJalonAlerte, qui exige une correspondance
// exacte) — sert à la liste vivante du tableau de bord.
export function classerUrgenceEcheance(joursRestants: number, jalons: JalonsAlerte = JALONS_PAR_DEFAUT): JalonDetecte | null {
  if (joursRestants <= jalons.urgent) return { jours: jalons.urgent, rang: 1 };
  if (joursRestants <= jalons.modere) return { jours: jalons.modere, rang: 2 };
  if (joursRestants <= jalons.anticipe) return { jours: jalons.anticipe, rang: 3 };
  return null;
}
