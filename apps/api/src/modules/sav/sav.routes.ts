import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { enregistrerPhotoSav, listerPhotosSav, trouverPhotoSav } from "./sav-photo.service.js";
import { listerPaiementsFacture } from "../factures/paiement.repository.js";
import { listerAvoirsFacture } from "../factures/avoir.service.js";

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 5.10, 8.4 : module SAV — accessible aux rôles pouvant recevoir un appareil
// au comptoir (Administrateur, Gérant, Caissier) et au Technicien SAV.
export function registerSavRoutes(app: FastifyInstance, db: Db, dossierPhotos: string, guards: RouteGuards & { sav: RouteGuards["ventes"] }) {
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
        // 6.4 point 5, 9.4 : nécessaire pour calculer le solde restant dû après
        // un encaissement partiel au passage en LIVRE (voir sav.service.ts)
        paiements: dossier.idFacture ? listerPaiementsFacture(db, dossier.idFacture) : [],
        // 6.4 : idem pour un avoir émis a posteriori sur cette facture
        avoirs: dossier.idFacture ? listerAvoirsFacture(db, dossier.idFacture) : [],
        photos: listerPhotosSav(db, idDossierSav),
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

  // 5.10 : "photos optionnelles" du dossier SAV
  app.post<{ Params: { idDossierSav: string } }>(
    "/api/v1/sav/dossiers/:idDossierSav/photos",
    { preHandler: [guards.authRequis, guards.sav] },
    async (request, reply) => {
      try {
        const fichier = await request.file();
        if (!fichier) throw new Error("Aucun fichier fourni");
        const photo = enregistrerPhotoSav(db, dossierPhotos, {
          idDossierSav: Number(request.params.idDossierSav),
          contenu: await fichier.toBuffer(),
          nomFichierOriginal: fichier.filename,
          typeMime: fichier.mimetype,
        });
        reply.code(201).send(photo);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get<{ Params: { idPhoto: string } }>(
    "/api/v1/sav/photos/:idPhoto",
    { preHandler: [guards.authRequis, guards.sav] },
    async (request, reply) => {
      const photo = trouverPhotoSav(db, Number(request.params.idPhoto));
      if (!photo) {
        reply.code(404).send({ erreur: `Photo ${request.params.idPhoto} introuvable` });
        return;
      }
      reply.code(200).header("Content-Type", photo.typeMime).send(readFileSync(join(dossierPhotos, photo.nomFichier)));
    }
  );
}
