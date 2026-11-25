import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { obtenirOuCreerLicence, revaliderLicence, calculerEtatLicence, prolongerLicence, appliquerCleRenouvellement } from "./licence.service.js";
import { lireClePublique } from "./cle-renouvellement.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";

// 10.4 : consultable par tout utilisateur connecté (l'état dégradé doit être
// visible de tous, pas seulement de l'encadrement) — aucune restriction de
// rôle au-delà de l'authentification.
export function registerLicenceRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; admin: Guard }, clePublique?: string) {
  const parCle = clePublique !== undefined && clePublique !== "";
  // une faute dans la clé inscrite se voit au démarrage : traitée comme absente, elle rouvrirait en silence la saisie libre d'une date
  if (parCle) lireClePublique(clePublique);
  const etat = () => ({ ...calculerEtatLicence(obtenirOuCreerLicence(db, new Date().toISOString()), new Date().toISOString()), renouvellementParCle: parCle });

  app.get("/api/v1/licence/etat", { preHandler: [guards.authRequis] }, async (_request, reply) => {
    reply.code(200).send(etat());
  });

  // 10.4 : clé de renouvellement signée par l'éditeur, collée par l'administrateur. Sous /api/v1/licence : possible en lecture seule.
  app.post<{ Body: { cle?: string } }>("/api/v1/licence/cle", { preHandler: [guards.authRequis, guards.admin] }, async (request, reply) => {
    try {
      if (!parCle) throw new Error("Le renouvellement par clé n'est pas activé sur cette version : saisissez la nouvelle échéance");
      appliquerCleRenouvellement(db, { cle: (request.body ?? {}).cle as string, clePublique, userId: request.user.idUser });
      reply.code(200).send(etat());
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });

  // Pilote : l'administrateur prolonge l'abonnement en saisissant la nouvelle échéance. Sous /api/v1/licence, donc encore
  // possible en mode dégradé (lecture seule) : c'est précisément là qu'on en a besoin.
  app.put<{ Body: { dateExpiration?: string } }>("/api/v1/licence/expiration", { preHandler: [guards.authRequis, guards.admin] }, async (request, reply) => {
    try {
      // avec la clé de l'éditeur inscrite, une boutique ne prolonge plus son abonnement elle-même
      if (parCle) throw new Error("L'abonnement se prolonge avec une clé de renouvellement fournie par l'éditeur de MboaPilot");
      prolongerLicence(db, { dateExpiration: (request.body ?? {}).dateExpiration as string, userId: request.user.idUser });
      reply.code(200).send(etat());
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });

  // 10.4 étape 2 : revalidation manuelle (ex. bouton "Revalider maintenant"
  // après reconnexion), en plus de la tentative automatique au démarrage.
  app.post("/api/v1/licence/revalider", { preHandler: [guards.authRequis] }, async (_request, reply) => {
    revaliderLicence(db, new Date().toISOString());
    reply.code(200).send(etat());
  });
}
