import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { siteAutorise } from "../auth/auth.plugin.js";
import * as schema from "../../db/schema.js";
import { fermerCaisse, listerClotures, obtenirClotureOuverte, obtenirComptagesCloture, ouvrirCaisse, type ComptageInput } from "./cloture-caisse.service.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";

const ERREUR_SITE_CLOTURE = { erreur: "Cette session de caisse n'appartient pas à votre site" };

// 13.1 : clôture de caisse quotidienne — l'ouverture (fond de caisse) reste
// accessible aux rôles de vente qui démarrent un service ; la fermeture
// (comptage et validation de l'écart théorique/réel) est réservée à
// l'encadrement, comme les autres contrôles financiers (avoirs, stock).
export function registerClotureCaisseRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; ventes: Guard; validationCloture: Guard }) {
  app.get(
    "/api/v1/cloture-caisse/ouverte",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      reply.code(200).send(obtenirClotureOuverte(db, request.user.siteId) ?? null);
    }
  );

  app.get(
    "/api/v1/cloture-caisse",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      reply.code(200).send(listerClotures(db, request.user.siteId));
    }
  );

  app.get<{ Params: { idCloture: string } }>(
    "/api/v1/cloture-caisse/:idCloture/comptages",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      const idCloture = Number(request.params.idCloture);
      const cloture = db.select().from(schema.clotureCaisse).where(eq(schema.clotureCaisse.idCloture, idCloture)).get();
      if (cloture && !siteAutorise(request.user, cloture.siteId)) {
        reply.code(403).send(ERREUR_SITE_CLOTURE);
        return;
      }
      reply.code(200).send(obtenirComptagesCloture(db, idCloture));
    }
  );

  app.post<{ Body: { userId: number; fondOuverture: number } }>(
    "/api/v1/cloture-caisse/ouvrir",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        reply.code(201).send(ouvrirCaisse(db, { ...request.body, siteId: request.user.siteId }));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { idCloture: string }; Body: { userId: number; comptages: ComptageInput[] } }>(
    "/api/v1/cloture-caisse/:idCloture/fermer",
    { preHandler: [guards.authRequis, guards.validationCloture] },
    async (request, reply) => {
      const idCloture = Number(request.params.idCloture);
      const cloture = db.select().from(schema.clotureCaisse).where(eq(schema.clotureCaisse.idCloture, idCloture)).get();
      if (cloture && !siteAutorise(request.user, cloture.siteId)) {
        reply.code(403).send(ERREUR_SITE_CLOTURE);
        return;
      }
      try {
        const resultat = fermerCaisse(db, {
          idCloture,
          userId: request.body.userId,
          comptages: request.body.comptages,
        });
        reply.code(200).send(resultat);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
