import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { RouteGuards } from "../auth/auth.plugin.js";
import { recruterAbonne, type RecruterAbonneParams } from "./recrutement.service.js";
import { reabonner, type ReabonnerParams } from "./reabonnement.service.js";
import { echangerMateriel, type EchangerMaterielParams } from "./echange-materiel.service.js";
import { changerFormule, type ChangerFormuleParams } from "./changement-formule.service.js";
import { listerAbonnementsParAbonne } from "./abonnement.repository.js";

// 11.2 : les opérations de vente (recrutement, réabonnement) sont réservées aux
// rôles habilités à encaisser — cohérent avec le périmètre de l'écran de caisse.
export function registerAbonnementsRoutes(app: FastifyInstance, db: Db, guards: RouteGuards) {
  app.get<{ Params: { idAbonne: string } }>(
    "/api/v1/abonnes/:idAbonne/abonnements",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      reply.code(200).send(listerAbonnementsParAbonne(db, Number(request.params.idAbonne)));
    }
  );

  app.post<{ Body: RecruterAbonneParams }>(
    "/api/v1/recrutements",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        const resultat = recruterAbonne(db, request.body);
        reply.code(201).send(resultat);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { numeroAbonnement: string }; Body: Omit<ReabonnerParams, "numeroAbonnement"> }>(
    "/api/v1/abonnements/:numeroAbonnement/reabonnements",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        const resultat = reabonner(db, {
          ...request.body,
          numeroAbonnement: Number(request.params.numeroAbonnement),
        });
        reply.code(200).send(resultat);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { numeroAbonnement: string }; Body: Omit<EchangerMaterielParams, "numeroAbonnement"> }>(
    "/api/v1/abonnements/:numeroAbonnement/echange-materiel",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        const resultat = echangerMateriel(db, {
          ...request.body,
          numeroAbonnement: Number(request.params.numeroAbonnement),
        });
        reply.code(201).send(resultat);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { numeroAbonnement: string }; Body: Omit<ChangerFormuleParams, "numeroAbonnement"> }>(
    "/api/v1/abonnements/:numeroAbonnement/changement-formule",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        const resultat = changerFormule(db, {
          ...request.body,
          numeroAbonnement: Number(request.params.numeroAbonnement),
        });
        reply.code(200).send(resultat);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}
