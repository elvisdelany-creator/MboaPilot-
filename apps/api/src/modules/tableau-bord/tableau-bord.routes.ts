import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard, RouteGuards } from "../auth/auth.plugin.js";
import {
  calculerEvolutionCA,
  calculerIndicateursJour,
  calculerMargeParArticleJour,
  calculerValorisationStock,
  calculerVentilationCAJour,
  listerCommissionsCanalplusEnCours,
  listerEncaissementsJour,
} from "./tableau-bord.service.js";
import { listerResumesApporteurs } from "../apporteurs/apporteur.service.js";

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

  // 9.3 : courbe d'évolution du CA, "filtrable... par famille d'activité"
  app.get<{ Querystring: { siteId: string; aujourdHui: string; jours?: string; libelleFamille?: string } }>(
    "/api/v1/tableau-bord/evolution-ca",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      const { siteId, aujourdHui, jours, libelleFamille } = request.query;
      reply.code(200).send(calculerEvolutionCA(db, Number(siteId), aujourdHui, jours ? Number(jours) : 30, libelleFamille || undefined));
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

  // 8.6 : "Chiffre d'affaires — par famille d'activité"
  app.get<{ Querystring: { siteId: string; aujourdHui: string } }>(
    "/api/v1/tableau-bord/ventilation-ca",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      const { siteId, aujourdHui } = request.query;
      reply.code(200).send(calculerVentilationCAJour(db, Number(siteId), aujourdHui));
    }
  );

  // 6.1, 8.6 : "Marge / rentabilité — par famille et par article"
  app.get<{ Querystring: { siteId: string; aujourdHui: string } }>(
    "/api/v1/tableau-bord/marge-par-article",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      const { siteId, aujourdHui } = request.query;
      reply.code(200).send(calculerMargeParArticleJour(db, Number(siteId), aujourdHui));
    }
  );

  app.get<{ Querystring: { siteId: string } }>(
    "/api/v1/tableau-bord/commissions-canalplus",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      reply.code(200).send(listerCommissionsCanalplusEnCours(db, Number(request.query.siteId)));
    }
  );

  // 8.6 : "Suivi des apporteurs d'affaires — Chiffre d'affaires et commissions
  // générés par chaque apporteur" — mono-entreprise (2.2), pas de filtre par site
  app.get("/api/v1/tableau-bord/apporteurs", { preHandler: [guards.authRequis, guards.pilotage] }, async (_request, reply) => {
    reply.code(200).send(listerResumesApporteurs(db));
  });
}
