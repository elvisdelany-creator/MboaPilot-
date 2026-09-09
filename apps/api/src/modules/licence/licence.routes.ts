import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { obtenirOuCreerLicence, revaliderLicence, calculerEtatLicence } from "./licence.service.js";

// 10.4 : consultable par tout utilisateur connecté (l'état dégradé doit être
// visible de tous, pas seulement de l'encadrement) — aucune restriction de
// rôle au-delà de l'authentification.
export function registerLicenceRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard }) {
  app.get("/api/v1/licence/etat", { preHandler: [guards.authRequis] }, async (_request, reply) => {
    const licence = obtenirOuCreerLicence(db, new Date().toISOString());
    reply.code(200).send(calculerEtatLicence(licence, new Date().toISOString()));
  });

  // 10.4 étape 2 : revalidation manuelle (ex. bouton "Revalider maintenant"
  // après reconnexion), en plus de la tentative automatique au démarrage.
  app.post("/api/v1/licence/revalider", { preHandler: [guards.authRequis] }, async (_request, reply) => {
    const licence = revaliderLicence(db, new Date().toISOString());
    reply.code(200).send(calculerEtatLicence(licence, new Date().toISOString()));
  });
}
