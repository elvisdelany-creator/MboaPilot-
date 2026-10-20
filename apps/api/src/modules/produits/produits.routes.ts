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
import { envoyerErreur, gestionnaireErreurFastify } from "../../lib/erreurs-api.js";

const TAILLE_MAX_IMPORT_CSV_OCTETS = 10 * 1024 * 1024;

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

  app.post<{ Body: Omit<CreerProduitInput, "siteId"> & { siteId?: number } }>(
    "/api/v1/produits",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        // 2.5.2 : le siteId du corps n'est qu'une indication client — celui de
        // l'appelant (relu en base à chaque requête) fait seul foi
        reply.code(201).send(creerProduit(db, { ...request.body, siteId: request.user.siteId }));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.patch<{ Params: { idProduit: string }; Body: Omit<ModifierProduitInput, "userId"> }>(
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
        // 11.5 : l'auteur est l'utilisateur authentifié, que le client l'ait envoyé ou non
        reply.code(200).send(modifierProduit(db, idProduit, { ...request.body, userId: request.user.idUser }));
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

  // un catalogue réel peut compter des dizaines de milliers de références : 10 Mo (environ 110 000 lignes) au lieu de la
  // limite de 1 Mo des autres routes ; au-delà, un message qui dit quoi faire
  app.post<{ Body: { contenuCsv: string } }>(
    "/api/v1/produits/import-csv",
    {
      bodyLimit: TAILLE_MAX_IMPORT_CSV_OCTETS,
      errorHandler: (erreur, requete, reply) => {
        if (erreur.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
          reply.code(413).send({ erreur: "Le fichier CSV est trop volumineux (10 Mo au maximum) : divisez-le en plusieurs fichiers." });
          return;
        }
        gestionnaireErreurFastify(erreur, requete, reply);
      },
      preHandler: [guards.authRequis, guards.gestionCatalogue],
    },
    async (request, reply) => {
      try {
        reply.code(200).send(importerCatalogueCsv(db, request.user.siteId, request.body.contenuCsv, request.user.idUser));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
