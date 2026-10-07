import type { FastifyReply } from "fastify";

// Réponse d'erreur commune à toutes les routes. Les messages métier (écrits en
// français pour l'utilisateur) sont renvoyés tels quels ; les erreurs internes —
// contraintes SQLite et erreurs de programmation provoquées par une requête mal
// typée — sont traduites : elles citaient noms de tables/colonnes et morceaux de
// code, illisibles pour un caissier et révélateurs de la structure de la base.
export function messageClient(erreur: unknown): string {
  if (!(erreur instanceof Error)) return "Erreur inconnue";
  const { message } = erreur;

  if (/FOREIGN KEY constraint failed/i.test(message)) return "Un élément référencé par la demande n'existe pas (client, produit, site, formule…)";
  if (/NOT NULL constraint failed/i.test(message)) return "Des champs obligatoires sont manquants ou invalides";
  if (/UNIQUE constraint failed/i.test(message)) return "Cet enregistrement existe déjà";
  if (/CHECK constraint failed/i.test(message)) return "Une valeur est refusée par les règles de validation";
  if (
    erreur instanceof TypeError ||
    /is not a function|Cannot read propert|is not iterable|Too few parameter values|Too many parameter values|can only bind/i.test(message)
  ) {
    return "Requête mal formée : un champ a un type ou un format invalide";
  }
  return message;
}

export function envoyerErreur(reply: FastifyReply, erreur: unknown): void {
  const message = messageClient(erreur);
  // l'erreur d'origine reste disponible pour le diagnostic, côté serveur seulement
  if (erreur instanceof Error && message !== erreur.message) console.error("[API] erreur interne traduite pour le client :", erreur.message);
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}
