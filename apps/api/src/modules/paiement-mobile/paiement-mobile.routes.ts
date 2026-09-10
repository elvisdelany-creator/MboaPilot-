import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { RouteGuards } from "../auth/auth.plugin.js";
import type { FournisseurPaiementMobile } from "./fournisseur.js";
import { actualiserStatutTransaction, initierPaiementMobile, trouverTransaction, type InitierPaiementMobileParams } from "./paiement-mobile.service.js";

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 6.6 : paiement mobile (Orange Money et extensible) — mêmes rôles que les
// autres opérations d'encaissement de la caisse (2.5.1).
export function registerPaiementMobileRoutes(app: FastifyInstance, db: Db, fournisseur: FournisseurPaiementMobile, guards: RouteGuards) {
  app.post<{ Body: InitierPaiementMobileParams }>(
    "/api/v1/paiements-mobiles",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        reply.code(201).send(await initierPaiementMobile(db, fournisseur, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get<{ Params: { idTransaction: string } }>(
    "/api/v1/paiements-mobiles/:idTransaction",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      const transaction = trouverTransaction(db, Number(request.params.idTransaction));
      if (!transaction) {
        reply.code(404).send({ erreur: "Transaction introuvable" });
        return;
      }
      reply.code(200).send(transaction);
    }
  );

  // 6.6 : "polling ou callback/webhook" — en l'absence de webhook opérateur
  // réel, le poste de caisse interroge périodiquement ce point d'entrée.
  app.post<{ Params: { idTransaction: string } }>(
    "/api/v1/paiements-mobiles/:idTransaction/actualiser",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        reply.code(200).send(await actualiserStatutTransaction(db, fournisseur, Number(request.params.idTransaction), request.user.idUser));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
