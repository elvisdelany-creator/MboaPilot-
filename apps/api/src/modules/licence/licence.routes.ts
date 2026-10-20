import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { obtenirOuCreerLicence, revaliderLicence, calculerEtatLicence, prolongerLicence } from "./licence.service.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";

// 10.4 : consultable par tout utilisateur connecté (l'état dégradé doit être
// visible de tous, pas seulement de l'encadrement) — aucune restriction de
// rôle au-delà de l'authentification.
export function registerLicenceRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; admin: Guard }) {
  app.get("/api/v1/licence/etat", { preHandler: [guards.authRequis] }, async (_request, reply) => {
    const licence = obtenirOuCreerLicence(db, new Date().toISOString());
    reply.code(200).send(calculerEtatLicence(licence, new Date().toISOString()));
  });

  // Pilote : l'administrateur prolonge l'abonnement en saisissant la nouvelle échéance. Sous /api/v1/licence, donc encore
  // possible en mode dégradé (lecture seule) : c'est précisément là qu'on en a besoin.
  app.put<{ Body: { dateExpiration?: string } }>("/api/v1/licence/expiration", { preHandler: [guards.authRequis, guards.admin] }, async (request, reply) => {
    try {
      const licence = prolongerLicence(db, { dateExpiration: (request.body ?? {}).dateExpiration as string, userId: request.user.idUser });
      reply.code(200).send(calculerEtatLicence(licence, new Date().toISOString()));
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });

  // 10.4 étape 2 : revalidation manuelle (ex. bouton "Revalider maintenant"
  // après reconnexion), en plus de la tentative automatique au démarrage.
  app.post("/api/v1/licence/revalider", { preHandler: [guards.authRequis] }, async (_request, reply) => {
    const licence = revaliderLicence(db, new Date().toISOString());
    reply.code(200).send(calculerEtatLicence(licence, new Date().toISOString()));
  });
}
