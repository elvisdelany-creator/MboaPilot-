import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { listerCatalogue } from "./catalogue.repository.js";

// catalogue en lecture : accessible à tout utilisateur authentifié, quel que soit son rôle
export function registerCatalogueRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard }) {
  app.get("/api/v1/catalogue", { preHandler: [guards.authRequis] }, async (_request, reply) => {
    reply.code(200).send(listerCatalogue(db));
  });
}
