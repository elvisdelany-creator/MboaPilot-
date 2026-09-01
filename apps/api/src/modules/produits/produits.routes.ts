import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { listerProduits } from "./produit.repository.js";

export function registerProduitsRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard }) {
  app.get<{ Querystring: { siteId: string } }>(
    "/api/v1/produits",
    { preHandler: [guards.authRequis] },
    async (request, reply) => {
      reply.code(200).send(listerProduits(db, Number(request.query.siteId)));
    }
  );
}
