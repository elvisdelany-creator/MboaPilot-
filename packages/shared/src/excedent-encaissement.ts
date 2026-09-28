// 8.5, 9.2 : "calcul automatique des totaux et de la monnaie rendue" — un
// montant encaissé supérieur au total est un geste normal (rendu de monnaie),
// jamais rejeté. Mais rien ne distingue aujourd'hui un vrai rendu de monnaie
// (quelques billets d'écart) d'une erreur de saisie (chiffre en trop sur un
// clavier numérique) : au-delà de ce seuil d'écart absolu, l'ampleur n'est
// plus plausible pour une remise en espèces réelle et mérite une confirmation
// explicite avant validation, plutôt qu'un rejet (le montant reste légitime).
export const SEUIL_EXCEDENT_ENCAISSEMENT_SUSPECT = 50000;

export function excedentEncaissementSuspect(montantEncaisse: number, total: number): boolean {
  return montantEncaisse - total > SEUIL_EXCEDENT_ENCAISSEMENT_SUSPECT;
}
