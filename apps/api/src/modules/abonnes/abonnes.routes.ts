import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard, RouteGuards } from "../auth/auth.plugin.js";
import { modifierAbonne, rechercherAbonnes, trouverAbonne, type ModifierAbonneInput } from "./abonne.repository.js";
import { construireFiche360 } from "./fiche-360.service.js";
import { fusionnerAbonnes, type FusionnerAbonnesParams } from "./fusion-abonnes.service.js";
import { anonymiserAbonne } from "./anonymisation.service.js";

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 8.1, 11.3 : gestion des clients/abonnés — recherche, consultation et
// modification de fiche (rôles de vente) ; fusion de doublons et
// anonymisation (droit de suppression), opérations destructrices, réservées
// respectivement à l'encadrement et, pour l'anonymisation, à l'Administrateur
// seul (sensibilité plus élevée — données personnelles, 11.3).
export function registerAbonnesRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { fusionAbonnes: Guard; anonymisationAbonne: Guard }) {
  app.get<{ Querystring: { siteId: string; q: string } }>(
    "/api/v1/abonnes",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      const { siteId, q } = request.query;
      const resultats = rechercherAbonnes(db, Number(siteId), q);
      reply.code(200).send(resultats);
    }
  );

  app.post<{ Body: FusionnerAbonnesParams }>(
    "/api/v1/abonnes/fusion",
    { preHandler: [guards.authRequis, guards.fusionAbonnes] },
    async (request, reply) => {
      try {
        reply.code(200).send(fusionnerAbonnes(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get<{ Params: { idAbonne: string } }>(
    "/api/v1/abonnes/:idAbonne",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      const abonne = trouverAbonne(db, Number(request.params.idAbonne));
      if (!abonne) {
        reply.code(404).send({ erreur: "Abonné introuvable" });
        return;
      }
      reply.code(200).send(abonne);
    }
  );

  app.patch<{ Params: { idAbonne: string }; Body: ModifierAbonneInput }>(
    "/api/v1/abonnes/:idAbonne",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      // 6.3, 14.2 : "non modifiable après création sans droit administrateur"
      if (request.body.apporteurId !== undefined && request.user.role !== "ADMINISTRATEUR") {
        reply.code(403).send({ erreur: "Seul un administrateur peut modifier l'apporteur d'affaires d'un abonné" });
        return;
      }
      try {
        reply.code(200).send(modifierAbonne(db, Number(request.params.idAbonne), request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get<{ Params: { idAbonne: string } }>(
    "/api/v1/abonnes/:idAbonne/fiche-360",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        reply.code(200).send(construireFiche360(db, Number(request.params.idAbonne)));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  // 11.3 : droit de suppression — outil technique (voir avertissement dans
  // anonymisation.service.ts), réservé à l'Administrateur
  app.post<{ Params: { idAbonne: string }; Body: { userId: number } }>(
    "/api/v1/abonnes/:idAbonne/anonymiser",
    { preHandler: [guards.authRequis, guards.anonymisationAbonne] },
    async (request, reply) => {
      try {
        reply.code(200).send(anonymiserAbonne(db, { idAbonne: Number(request.params.idAbonne), userId: request.body.userId }));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
