import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { RouteGuards } from "../auth/auth.plugin.js";
import { executerJobQuotidien } from "./job-quotidien.service.js";
import { listerAbonnementsExpires, listerAlertesEcheance } from "./alerte-echeance.repository.js";

// 4.3, 4.4, 6.2 : déclenchement manuel du job quotidien (utile en complément
// de la planification automatique du serveur — server.ts) et lecture des
// abonnements à échéance pour le tableau de bord (8.6, 9.3).
export function registerJobsRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { admin: RouteGuards["ventes"] }) {
  app.post("/api/v1/jobs/quotidien", { preHandler: [guards.authRequis, guards.admin] }, async (_request, reply) => {
    const aujourdHui = new Date().toISOString().slice(0, 10);
    reply.code(200).send(executerJobQuotidien(db, aujourdHui));
  });

  // 8.6 : "Abonnements à échéance — Listes J-7/J-3/J-1... filtrable par famille et par site"
  app.get<{ Querystring: { siteId: string; idFamille?: string } }>(
    "/api/v1/alertes-echeance",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      const aujourdHui = new Date().toISOString().slice(0, 10);
      const idFamille = request.query.idFamille !== undefined ? Number(request.query.idFamille) : undefined;
      reply.code(200).send(listerAlertesEcheance(db, Number(request.query.siteId), aujourdHui, idFamille));
    }
  );

  // 4.4, 8.8 : liste dédiée « Abonnements expirés » du tableau de bord,
  // filtrable par famille — bornée par la durée de rétention paramétrable
  app.get<{ Querystring: { siteId: string; idFamille?: string } }>(
    "/api/v1/abonnements-expires",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      const aujourdHui = new Date().toISOString().slice(0, 10);
      const idFamille = request.query.idFamille !== undefined ? Number(request.query.idFamille) : undefined;
      reply.code(200).send(listerAbonnementsExpires(db, Number(request.query.siteId), aujourdHui, idFamille));
    }
  );
}
