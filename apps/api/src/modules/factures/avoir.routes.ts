import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { RouteGuards, Guard } from "../auth/auth.plugin.js";
import { creerAvoir, listerLignesFacture, type LigneAvoirInput } from "./avoir.service.js";

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 6.4 : émission d'un avoir — correction d'une facture VALIDEE, réservée à
// l'encadrement (opération financière correctrice, comme la fusion de doublons).
export function registerAvoirRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { gestionAvoirs: Guard }) {
  app.get<{ Params: { idFacture: string } }>(
    "/api/v1/factures/:idFacture/lignes",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      reply.code(200).send(listerLignesFacture(db, Number(request.params.idFacture)));
    }
  );

  app.post<{ Params: { idFacture: string }; Body: { lignes: LigneAvoirInput[]; restituerStock: boolean; userId: number } }>(
    "/api/v1/factures/:idFacture/avoir",
    { preHandler: [guards.authRequis, guards.gestionAvoirs] },
    async (request, reply) => {
      try {
        reply.code(201).send(
          creerAvoir(db, {
            idFactureOrigine: Number(request.params.idFacture),
            lignes: request.body.lignes,
            restituerStock: request.body.restituerStock,
            userId: request.body.userId,
          })
        );
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
