import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { RouteGuards } from "../auth/auth.plugin.js";
import { creerVenteProduits, type CreerVenteProduitsParams } from "./vente.service.js";

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 5.2, 5.3, 8.5 : vente rapide de produits/services hors abonnement —
// réservée aux mêmes rôles que la vente d'abonnements (2.5.1).
export function registerVentesRoutes(app: FastifyInstance, db: Db, guards: RouteGuards) {
  app.post<{ Body: CreerVenteProduitsParams }>(
    "/api/v1/ventes",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        // 2.5.2 : le siteId du corps n'est qu'une indication client — celui de
        // l'appelant (relu en base à chaque requête) fait seul foi
        reply.code(201).send(creerVenteProduits(db, { ...request.body, siteId: request.user.siteId }));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
