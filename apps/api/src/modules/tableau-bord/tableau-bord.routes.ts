import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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

// 11.1 : les requêtes bornent les factures par plage de dates — un `aujourdHui`
// absent ou invalide est refusé ici (400) plutôt que de faire échouer le calcul.
async function exigerJourValide(request: FastifyRequest, reply: FastifyReply) {
  const jour = (request.query as { aujourdHui?: string }).aujourdHui;
  const valide = typeof jour === "string" && /^\d{4}-\d{2}-\d{2}$/.test(jour) && !Number.isNaN(Date.parse(jour + "T00:00:00Z")) && new Date(jour + "T00:00:00Z").toISOString().startsWith(jour);
  if (!valide) reply.code(400).send({ erreur: "Le paramètre aujourdHui doit être une date au format AAAA-MM-JJ" });
}

// 8.6, 9.3 : tableau de bord de pilotage — vue Administrateur/Gérant/Comptable
// (indicateurs financiers), distincte des alertes d'échéance/de stock déjà
// ouvertes aux rôles de vente sur le tableau de bord de base.
export function registerTableauBordRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { pilotage: Guard }) {
  app.get<{ Querystring: { aujourdHui: string } }>(
    "/api/v1/tableau-bord/indicateurs",
    { preHandler: [guards.authRequis, guards.pilotage, exigerJourValide] },
    async (request, reply) => {
      reply.code(200).send(calculerIndicateursJour(db, request.user.siteId, request.query.aujourdHui));
    }
  );

  // 9.3 : courbe d'évolution du CA, "filtrable... par famille d'activité"
  app.get<{ Querystring: { aujourdHui: string; jours?: string; libelleFamille?: string } }>(
    "/api/v1/tableau-bord/evolution-ca",
    { preHandler: [guards.authRequis, guards.pilotage, exigerJourValide] },
    async (request, reply) => {
      const { aujourdHui, jours, libelleFamille } = request.query;
      reply.code(200).send(calculerEvolutionCA(db, request.user.siteId, aujourdHui, jours ? Number(jours) : 30, libelleFamille || undefined));
    }
  );

  app.get(
    "/api/v1/tableau-bord/valorisation-stock",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      reply.code(200).send({ valorisation: calculerValorisationStock(db, request.user.siteId) });
    }
  );

  app.get<{ Querystring: { aujourdHui: string } }>(
    "/api/v1/tableau-bord/encaissements-jour",
    { preHandler: [guards.authRequis, guards.pilotage, exigerJourValide] },
    async (request, reply) => {
      reply.code(200).send(listerEncaissementsJour(db, request.user.siteId, request.query.aujourdHui));
    }
  );

  // 8.6 : "Chiffre d'affaires — par famille d'activité"
  app.get<{ Querystring: { aujourdHui: string } }>(
    "/api/v1/tableau-bord/ventilation-ca",
    { preHandler: [guards.authRequis, guards.pilotage, exigerJourValide] },
    async (request, reply) => {
      reply.code(200).send(calculerVentilationCAJour(db, request.user.siteId, request.query.aujourdHui));
    }
  );

  // 6.1, 8.6 : "Marge / rentabilité — par famille et par article"
  app.get<{ Querystring: { aujourdHui: string } }>(
    "/api/v1/tableau-bord/marge-par-article",
    { preHandler: [guards.authRequis, guards.pilotage, exigerJourValide] },
    async (request, reply) => {
      reply.code(200).send(calculerMargeParArticleJour(db, request.user.siteId, request.query.aujourdHui));
    }
  );

  app.get(
    "/api/v1/tableau-bord/commissions-canalplus",
    { preHandler: [guards.authRequis, guards.pilotage] },
    async (request, reply) => {
      reply.code(200).send(listerCommissionsCanalplusEnCours(db, request.user.siteId));
    }
  );

  // 8.6 : "Suivi des apporteurs d'affaires — Chiffre d'affaires et commissions
  // générés par chaque apporteur" — mono-entreprise (2.2), pas de filtre par site
  app.get("/api/v1/tableau-bord/apporteurs", { preHandler: [guards.authRequis, guards.pilotage] }, async (_request, reply) => {
    reply.code(200).send(listerResumesApporteurs(db));
  });
}
