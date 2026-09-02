import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard, RouteGuards } from "../auth/auth.plugin.js";
import {
  creerProduit,
  listerHistoriquePrixProduit,
  listerProduits,
  modifierProduit,
  type CreerProduitInput,
  type ModifierProduitInput,
} from "./produit.repository.js";

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 8.2 : gestion du catalogue — consultation ouverte à tout utilisateur
// authentifié (nécessaire à la caisse, au SAV, à l'échange de matériel),
// création/édition des fiches article réservée à Administrateur/Gérant.
export function registerProduitsRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { gestionCatalogue: Guard }) {
  app.get<{ Querystring: { siteId: string } }>(
    "/api/v1/produits",
    { preHandler: [guards.authRequis] },
    async (request, reply) => {
      reply.code(200).send(listerProduits(db, Number(request.query.siteId)));
    }
  );

  app.post<{ Body: CreerProduitInput }>(
    "/api/v1/produits",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        reply.code(201).send(creerProduit(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.patch<{ Params: { idProduit: string }; Body: ModifierProduitInput }>(
    "/api/v1/produits/:idProduit",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        reply.code(200).send(modifierProduit(db, Number(request.params.idProduit), request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get<{ Params: { idProduit: string } }>(
    "/api/v1/produits/:idProduit/historique-prix",
    { preHandler: [guards.authRequis] },
    async (request, reply) => {
      reply.code(200).send(listerHistoriquePrixProduit(db, Number(request.params.idProduit)));
    }
  );
}
