import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard, RouteGuards } from "../auth/auth.plugin.js";
import { listerMouvementsProduit } from "./stock.repository.js";
import {
  ajusterInventaire,
  enregistrerCasse,
  listerAlertesStock,
  receptionnerAchat,
  type AjusterInventaireParams,
  type EnregistrerCasseParams,
  type ReceptionnerAchatParams,
} from "./stock.service.js";
import { transfererStock, type TransfererStockParams } from "./transfert.service.js";

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 5.2, 8.6, 9.3 : suivi de stock — consultation (alertes, historique) ouverte
// aux rôles de vente/SAV, mouvements correctifs (achat, casse, inventaire)
// réservés à Administrateur/Gérant (validation par un rôle habilité, 5.2).
export function registerStockRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { gestionStock: Guard }) {
  app.get<{ Querystring: { siteId: string } }>(
    "/api/v1/stock/alertes",
    { preHandler: [guards.authRequis] },
    async (request, reply) => {
      reply.code(200).send(listerAlertesStock(db, Number(request.query.siteId)));
    }
  );

  app.get<{ Params: { idProduit: string } }>(
    "/api/v1/produits/:idProduit/mouvements",
    { preHandler: [guards.authRequis] },
    async (request, reply) => {
      reply.code(200).send(listerMouvementsProduit(db, Number(request.params.idProduit)));
    }
  );

  app.post<{ Body: ReceptionnerAchatParams }>(
    "/api/v1/stock/achats",
    { preHandler: [guards.authRequis, guards.gestionStock] },
    async (request, reply) => {
      try {
        reply.code(201).send(receptionnerAchat(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Body: EnregistrerCasseParams }>(
    "/api/v1/stock/casses",
    { preHandler: [guards.authRequis, guards.gestionStock] },
    async (request, reply) => {
      try {
        reply.code(201).send(enregistrerCasse(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Body: AjusterInventaireParams }>(
    "/api/v1/stock/inventaires",
    { preHandler: [guards.authRequis, guards.gestionStock] },
    async (request, reply) => {
      try {
        reply.code(201).send(ajusterInventaire(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Body: TransfererStockParams }>(
    "/api/v1/stock/transferts",
    { preHandler: [guards.authRequis, guards.gestionStock] },
    async (request, reply) => {
      try {
        reply.code(201).send(transfererStock(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
