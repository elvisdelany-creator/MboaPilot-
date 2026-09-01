import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { RouteGuards } from "../auth/auth.plugin.js";
import {
  creerDossierSav,
  listerDossiersSav,
  listerHistoriqueSav,
  listerPiecesUtilisees,
  trouverDossierSav,
  trouverFactureSav,
  type OuvrirDossierInput,
} from "./sav.repository.js";
import { affecterPieceSav, changerStatutSav, type AffecterPieceParams, type ChangerStatutSavParams } from "./sav.service.js";

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 5.10, 8.4 : module SAV — accessible aux rôles pouvant recevoir un appareil
// au comptoir (Administrateur, Gérant, Caissier) et au Technicien SAV.
export function registerSavRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { sav: RouteGuards["ventes"] }) {
  app.get<{ Querystring: { siteId: string } }>(
    "/api/v1/sav/dossiers",
    { preHandler: [guards.authRequis, guards.sav] },
    async (request, reply) => {
      reply.code(200).send(listerDossiersSav(db, Number(request.query.siteId)));
    }
  );

  app.get<{ Params: { idDossierSav: string } }>(
    "/api/v1/sav/dossiers/:idDossierSav",
    { preHandler: [guards.authRequis, guards.sav] },
    async (request, reply) => {
      const idDossierSav = Number(request.params.idDossierSav);
      const dossier = trouverDossierSav(db, idDossierSav);
      if (!dossier) {
        reply.code(404).send({ erreur: `Dossier SAV ${idDossierSav} introuvable` });
        return;
      }
      reply.code(200).send({
        ...dossier,
        pieces: listerPiecesUtilisees(db, idDossierSav),
        historique: listerHistoriqueSav(db, idDossierSav),
        facture: dossier.idFacture ? (trouverFactureSav(db, dossier.idFacture) ?? null) : null,
      });
    }
  );

  app.post<{ Body: OuvrirDossierInput }>(
    "/api/v1/sav/dossiers",
    { preHandler: [guards.authRequis, guards.sav] },
    async (request, reply) => {
      try {
        reply.code(201).send(creerDossierSav(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { idDossierSav: string }; Body: Omit<AffecterPieceParams, "idDossierSav"> }>(
    "/api/v1/sav/dossiers/:idDossierSav/pieces",
    { preHandler: [guards.authRequis, guards.sav] },
    async (request, reply) => {
      try {
        affecterPieceSav(db, { ...request.body, idDossierSav: Number(request.params.idDossierSav) });
        reply.code(201).send({ ok: true });
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { idDossierSav: string }; Body: Omit<ChangerStatutSavParams, "idDossierSav"> }>(
    "/api/v1/sav/dossiers/:idDossierSav/statut",
    { preHandler: [guards.authRequis, guards.sav] },
    async (request, reply) => {
      try {
        const resultat = changerStatutSav(db, { ...request.body, idDossierSav: Number(request.params.idDossierSav) });
        reply.code(200).send(resultat);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
