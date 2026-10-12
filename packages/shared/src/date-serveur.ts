// Lecture des dates renvoyées par l'API. SQLite écrit ses horodatages en UTC et sans fuseau
// (« 2026-10-12 15:18:12 ») : le navigateur les lirait comme une heure locale, et l'affichage
// serait décalé du fuseau de l'utilisateur (1 h de retard au Cameroun, y compris sur les reçus).
const HORODATAGE_SANS_FUSEAU = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const DATE_SEULE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function lireDateServeur(valeur: string): Date {
  const jour = DATE_SEULE.exec(valeur);
  // un jour du calendrier (échéance, début d'abonnement) : minuit local, jamais décalé d'un jour
  if (jour) return new Date(Number(jour[1]), Number(jour[2]) - 1, Number(jour[3]));
  if (HORODATAGE_SANS_FUSEAU.test(valeur)) return new Date(`${valeur.replace(" ", "T")}Z`);
  return new Date(valeur);
}
