import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

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

const MESSAGES_FASTIFY: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: "Le corps de la requête n'est pas un JSON valide",
  FST_ERR_CTP_EMPTY_JSON_BODY: "Le corps de la requête est vide",
  FST_ERR_CTP_BODY_TOO_LARGE: "La requête est trop volumineuse",
  FST_ERR_CTP_INVALID_MEDIA_TYPE: "Type de contenu non pris en charge",
};

// Erreurs que Fastify produit lui-même (JSON invalide, corps trop gros, exception non
// prévue d'une route) : même format {erreur} que le reste de l'API — l'interface ne
// lit que cette clé — et jamais le message interne d'une exception non prévue (500).
export function gestionnaireErreurFastify(erreur: FastifyError, _requete: FastifyRequest, reply: FastifyReply): void {
  const statut = erreur.statusCode && erreur.statusCode >= 400 ? erreur.statusCode : 500;
  if (statut >= 500) {
    console.error("[API] erreur interne non prévue :", erreur);
    reply.code(500).send({ erreur: "Erreur interne du serveur. Réessayez, ou contactez l'administrateur si le problème persiste." });
    return;
  }
  reply.code(statut).send({ erreur: MESSAGES_FASTIFY[erreur.code] ?? messageClient(erreur) });
}

export function gestionnaireRouteInconnue(_requete: FastifyRequest, reply: FastifyReply): void {
  reply.code(404).send({ erreur: "Ressource introuvable" });
}
