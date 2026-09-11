import type { FastifyInstance, FastifyReply } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { fermerCaisse, listerClotures, obtenirClotureOuverte, obtenirComptagesCloture, ouvrirCaisse, type ComptageInput } from "./cloture-caisse.service.js";

function envoyerErreur(reply: FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 13.1 : clôture de caisse quotidienne — l'ouverture (fond de caisse) reste
// accessible aux rôles de vente qui démarrent un service ; la fermeture
// (comptage et validation de l'écart théorique/réel) est réservée à
// l'encadrement, comme les autres contrôles financiers (avoirs, stock).
export function registerClotureCaisseRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; ventes: Guard; validationCloture: Guard }) {
  app.get<{ Querystring: { siteId: string } }>(
    "/api/v1/cloture-caisse/ouverte",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      reply.code(200).send(obtenirClotureOuverte(db, Number(request.query.siteId)) ?? null);
    }
  );

  app.get<{ Querystring: { siteId: string } }>(
    "/api/v1/cloture-caisse",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      reply.code(200).send(listerClotures(db, Number(request.query.siteId)));
    }
  );

  app.get<{ Params: { idCloture: string } }>(
    "/api/v1/cloture-caisse/:idCloture/comptages",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      reply.code(200).send(obtenirComptagesCloture(db, Number(request.params.idCloture)));
    }
  );

  app.post<{ Body: { siteId: number; userId: number; fondOuverture: number } }>(
    "/api/v1/cloture-caisse/ouvrir",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        reply.code(201).send(ouvrirCaisse(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { idCloture: string }; Body: { userId: number; comptages: ComptageInput[] } }>(
    "/api/v1/cloture-caisse/:idCloture/fermer",
    { preHandler: [guards.authRequis, guards.validationCloture] },
    async (request, reply) => {
      try {
        const resultat = fermerCaisse(db, {
          idCloture: Number(request.params.idCloture),
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
