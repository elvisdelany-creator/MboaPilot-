import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard, RouteGuards } from "../auth/auth.plugin.js";
import { siteAutorise } from "../auth/auth.plugin.js";
import {
  creerProduit,
  estRoleEncadrement,
  listerHistoriquePrixProduit,
  listerProduits,
  masquerCoutHistoriquePrix,
  masquerCoutMargeProduit,
  modifierProduit,
  trouverProduit,
  type CreerProduitInput,
  type ModifierProduitInput,
} from "./produit.repository.js";
import { exporterCatalogueCsv, importerCatalogueCsv } from "./catalogue-import-export.service.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";

const ERREUR_SITE_PRODUIT = { erreur: "Ce produit n'appartient pas à votre site" };

// 8.2 : gestion du catalogue — consultation ouverte à tout utilisateur
// authentifié (nécessaire à la caisse, au SAV, à l'échange de matériel),
// création/édition des fiches article réservée à Administrateur/Gérant.
// Coût de revient et marge, eux, restent "réservés à l'encadrement" (comme
// l'export CSV ci-dessous) : masqués dans la réponse pour tout autre rôle.
export function registerProduitsRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { gestionCatalogue: Guard; lectureInterne: Guard }) {
  app.get(
    "/api/v1/produits",
    { preHandler: [guards.authRequis, guards.lectureInterne] },
    async (request, reply) => {
      const produits = listerProduits(db, request.user.siteId);
      reply.code(200).send(estRoleEncadrement(request.user.role) ? produits : produits.map(masquerCoutMargeProduit));
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
      const idProduit = Number(request.params.idProduit);
      const produit = trouverProduit(db, idProduit);
      if (produit && !siteAutorise(request.user, produit.siteId)) {
        reply.code(403).send(ERREUR_SITE_PRODUIT);
        return;
      }
      try {
        reply.code(200).send(modifierProduit(db, idProduit, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get<{ Params: { idProduit: string } }>(
    "/api/v1/produits/:idProduit/historique-prix",
    { preHandler: [guards.authRequis, guards.lectureInterne] },
    async (request, reply) => {
      const idProduit = Number(request.params.idProduit);
      const produit = trouverProduit(db, idProduit);
      if (produit && !siteAutorise(request.user, produit.siteId)) {
        reply.code(403).send(ERREUR_SITE_PRODUIT);
        return;
      }
      const historique = listerHistoriquePrixProduit(db, idProduit);
      reply.code(200).send(estRoleEncadrement(request.user.role) ? historique : historique.map(masquerCoutHistoriquePrix));
    }
  );

  // 8.2 : import/export de catalogue (CSV) — pour l'initialisation et les
  // mises à jour tarifaires en masse, réservé à l'encadrement (données de coût/marge).
  app.get(
    "/api/v1/produits/export-csv",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      reply
        .code(200)
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", "attachment; filename=catalogue.csv")
        .send(exporterCatalogueCsv(db, request.user.siteId));
    }
  );

  app.post<{ Body: { userId: number; contenuCsv: string } }>(
    "/api/v1/produits/import-csv",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        reply.code(200).send(importerCatalogueCsv(db, request.user.siteId, request.body.contenuCsv, request.body.userId));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
