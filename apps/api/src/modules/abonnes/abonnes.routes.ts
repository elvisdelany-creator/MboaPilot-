import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { RouteGuards } from "../auth/auth.plugin.js";
import { rechercherAbonnes } from "./abonne.repository.js";

export function registerAbonnesRoutes(app: FastifyInstance, db: Db, guards: RouteGuards) {
  app.get<{ Querystring: { siteId: string; q: string } }>(
    "/api/v1/abonnes",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      const { siteId, q } = request.query;
      const resultats = rechercherAbonnes(db, Number(siteId), q);
      reply.code(200).send(resultats);
    }
  );
}
