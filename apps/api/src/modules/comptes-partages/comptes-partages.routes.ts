import type { FastifyInstance, FastifyReply } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import {
  construireFicheComptePartage,
  creerComptePartage,
  listerComptesPartages,
  modifierComptePartage,
  type CreerComptePartageInput,
  type ModifierComptePartageInput,
} from "./compte-partage.repository.js";

function envoyerErreur(reply: FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 5.9, 11.2 : comptes partagés streaming (Netflix, Prime Vidéo, IPTV…) —
// identifiants visibles uniquement aux rôles de vente (qui doivent pouvoir
// les communiquer au client au comptoir) ; création/édition réservées à
// l'encadrement, comme pour les autres réglages de catalogue (8.2, 8.8).
export function registerComptesPartagesRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; ventes: Guard; gestionComptesPartages: Guard }) {
  app.get<{ Querystring: { siteId: string } }>(
    "/api/v1/comptes-partages",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      reply.code(200).send(listerComptesPartages(db, Number(request.query.siteId)));
    }
  );

  app.post<{ Body: CreerComptePartageInput }>(
    "/api/v1/comptes-partages",
    { preHandler: [guards.authRequis, guards.gestionComptesPartages] },
    async (request, reply) => {
      try {
        reply.code(201).send(creerComptePartage(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.patch<{ Params: { idComptePartage: string }; Body: ModifierComptePartageInput }>(
    "/api/v1/comptes-partages/:idComptePartage",
    { preHandler: [guards.authRequis, guards.gestionComptesPartages] },
    async (request, reply) => {
      try {
        const compte = modifierComptePartage(db, Number(request.params.idComptePartage), request.body);
        if (!compte) throw new Error(`Compte partagé ${request.params.idComptePartage} introuvable`);
        reply.code(200).send(compte);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get<{ Params: { idComptePartage: string } }>(
    "/api/v1/comptes-partages/:idComptePartage/fiche",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      const fiche = construireFicheComptePartage(db, Number(request.params.idComptePartage));
      if (!fiche) {
        reply.code(404).send({ erreur: `Compte partagé ${request.params.idComptePartage} introuvable` });
        return;
      }
      reply.code(200).send(fiche);
    }
  );
}
