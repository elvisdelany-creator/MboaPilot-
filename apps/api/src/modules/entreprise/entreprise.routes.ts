import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { trouverInfosEntrepriseParSite } from "./entreprise.repository.js";

// 6.7 : identification de l'entreprise/site pour l'en-tête des documents
// commerciaux (ticket de caisse, pro-forma) — accessible à tout rôle
// authentifié, chacun devant pouvoir imprimer un document pour son site.
export function registerEntrepriseRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard }) {
  app.get("/api/v1/entreprise", { preHandler: [guards.authRequis] }, async (request, reply) => {
    const infos = trouverInfosEntrepriseParSite(db, request.user.siteId);
    if (!infos) {
      reply.code(404).send({ erreur: "Entreprise introuvable" });
      return;
    }
    reply.code(200).send(infos);
  });
}
