import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard, RouteGuards } from "../auth/auth.plugin.js";
import {
  calculerEvolutionCA,
  calculerIndicateursJour,
  calculerValorisationStock,
  listerCommissionsCanalplusEnCours,
  listerEncaissementsJour,
} from "./tableau-bord.service.js";

// 8.6, 9.3 : tableau de bord de pilotage — vue Administrateur/Gérant/Comptable
// (indicateurs financiers), distincte des alertes d'échéance/de stock déjà
// ouvertes aux rôles de vente sur le tableau de bord de base.
export function registerTableauBordRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { pilotage: Guard }) {
  app.get<{ Querystring: { siteId: string; aujourdHui: string } }>(
    "/api/v1/tableau-bord/indicateurs",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      const { siteId, aujourdHui } = request.query;
      reply.code(200).send(calculerIndicateursJour(db, Number(siteId), aujourdHui));
    }
  );

  app.get<{ Querystring: { siteId: string; aujourdHui: string; jours?: string } }>(
    "/api/v1/tableau-bord/evolution-ca",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      const { siteId, aujourdHui, jours } = request.query;
      reply.code(200).send(calculerEvolutionCA(db, Number(siteId), aujourdHui, jours ? Number(jours) : 30));
    }
  );

  app.get<{ Querystring: { siteId: string } }>(
    "/api/v1/tableau-bord/valorisation-stock",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      reply.code(200).send({ valorisation: calculerValorisationStock(db, Number(request.query.siteId)) });
    }
  );

  app.get<{ Querystring: { siteId: string; aujourdHui: string } }>(
    "/api/v1/tableau-bord/encaissements-jour",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      const { siteId, aujourdHui } = request.query;
      reply.code(200).send(listerEncaissementsJour(db, Number(siteId), aujourdHui));
    }
  );

  app.get<{ Querystring: { siteId: string } }>(
    "/api/v1/tableau-bord/commissions-canalplus",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      reply.code(200).send(listerCommissionsCanalplusEnCours(db, Number(request.query.siteId)));
    }
  );
}
