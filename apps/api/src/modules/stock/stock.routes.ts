import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard, RouteGuards } from "../auth/auth.plugin.js";
import { siteAutorise } from "../auth/auth.plugin.js";
import { listerMouvementsProduit } from "./stock.repository.js";
import {
  ajusterInventaire,
  enregistrerCasse,
  listerAlertesStock,
  listerProduitsRotationLente,
  receptionnerAchat,
  type AjusterInventaireParams,
  type EnregistrerCasseParams,
  type ReceptionnerAchatParams,
} from "./stock.service.js";
import { transfererStock, type TransfererStockParams } from "./transfert.service.js";
import { estRoleEncadrement, masquerCoutMargeProduit, trouverProduit } from "../produits/produit.repository.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";

const ERREUR_SITE_PRODUIT = { erreur: "Ce produit n'appartient pas à votre site" };

// 5.2, 8.6, 9.3 : suivi de stock — consultation (alertes, historique) ouverte
// aux rôles de vente/SAV, mouvements correctifs (achat, casse, inventaire)
// réservés à Administrateur/Gérant (validation par un rôle habilité, 5.2).
export function registerStockRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { gestionStock: Guard; lectureInterne: Guard }) {
  app.get(
    "/api/v1/stock/alertes",
    { preHandler: [guards.authRequis, guards.lectureInterne] },
    async (request, reply) => {
      const alertes = listerAlertesStock(db, request.user.siteId);
      reply.code(200).send(estRoleEncadrement(request.user.role) ? alertes : alertes.map(masquerCoutMargeProduit));
    }
  );

  // 8.6, 9.3 : "État des stocks — produits à rotation lente"
  app.get(
    "/api/v1/stock/rotation-lente",
    { preHandler: [guards.authRequis, guards.lectureInterne] },
    async (request, reply) => {
      const aujourdHui = new Date().toISOString().slice(0, 10);
      const rotationLente = listerProduitsRotationLente(db, request.user.siteId, aujourdHui);
      reply
        .code(200)
        .send(
          estRoleEncadrement(request.user.role)
            ? rotationLente
            : rotationLente.map((r) => ({ ...r, produit: masquerCoutMargeProduit(r.produit) }))
        );
    }
  );

  app.get<{ Params: { idProduit: string } }>(
    "/api/v1/produits/:idProduit/mouvements",
    { preHandler: [guards.authRequis, guards.lectureInterne] },
    async (request, reply) => {
      const idProduit = Number(request.params.idProduit);
      const produit = trouverProduit(db, idProduit);
      if (produit && !siteAutorise(request.user, produit.siteId)) {
        reply.code(403).send(ERREUR_SITE_PRODUIT);
        return;
      }
      reply.code(200).send(listerMouvementsProduit(db, idProduit));
    }
  );

  app.post<{ Body: ReceptionnerAchatParams }>(
    "/api/v1/stock/achats",
    { preHandler: [guards.authRequis, guards.gestionStock] },
    async (request, reply) => {
      const produit = trouverProduit(db, request.body.idProduit);
      if (produit && !siteAutorise(request.user, produit.siteId)) {
        reply.code(403).send(ERREUR_SITE_PRODUIT);
        return;
      }
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
      const produit = trouverProduit(db, request.body.idProduit);
      if (produit && !siteAutorise(request.user, produit.siteId)) {
        reply.code(403).send(ERREUR_SITE_PRODUIT);
        return;
      }
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
      const produit = trouverProduit(db, request.body.idProduit);
      if (produit && !siteAutorise(request.user, produit.siteId)) {
        reply.code(403).send(ERREUR_SITE_PRODUIT);
        return;
      }
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
      const produitSource = trouverProduit(db, request.body.idProduitSource);
      if (produitSource && !siteAutorise(request.user, produitSource.siteId)) {
        reply.code(403).send(ERREUR_SITE_PRODUIT);
        return;
      }
      try {
        reply.code(201).send(transfererStock(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
