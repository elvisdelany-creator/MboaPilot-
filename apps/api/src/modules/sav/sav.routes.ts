import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { RouteGuards } from "../auth/auth.plugin.js";
import { siteAutorise } from "../auth/auth.plugin.js";
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
import { trouverAbonne } from "../abonnes/abonne.repository.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";

const TAILLE_MAX_PHOTO_OCTETS = 10 * 1024 * 1024;

const ERREUR_SITE_DOSSIER ={ erreur: "Ce dossier SAV n'appartient pas à votre site" };

// 5.10, 8.4 : module SAV — accessible aux rôles pouvant recevoir un appareil
// au comptoir (Administrateur, Gérant, Caissier) et au Technicien SAV.
export function registerSavRoutes(app: FastifyInstance, db: Db, dossierPhotos: string, guards: RouteGuards & { sav: RouteGuards["ventes"] }) {
  app.get(
    "/api/v1/sav/dossiers",
    { preHandler: [guards.authRequis, guards.sav] },
    async (request, reply) => {
      reply.code(200).send(listerDossiersSav(db, request.user.siteId));
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
      if (!siteAutorise(request.user, dossier.siteId)) {
        reply.code(403).send(ERREUR_SITE_DOSSIER);
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
      if (request.body.idAbonne !== undefined && request.body.idAbonne !== null) {
        const abonne = trouverAbonne(db, request.body.idAbonne);
        if (abonne && !siteAutorise(request.user, abonne.siteId)) {
          reply.code(403).send({ erreur: "Cet abonné n'appartient pas à votre site" });
          return;
        }
      }
      try {
        // 2.5.2 : le siteId du corps n'est qu'une indication client — celui de
        // l'appelant (relu en base à chaque requête) fait seul foi
        reply.code(201).send(creerDossierSav(db, { ...request.body, siteId: request.user.siteId }));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { idDossierSav: string }; Body: Omit<AffecterPieceParams, "idDossierSav"> }>(
    "/api/v1/sav/dossiers/:idDossierSav/pieces",
    { preHandler: [guards.authRequis, guards.sav] },
    async (request, reply) => {
      const idDossierSav = Number(request.params.idDossierSav);
      const dossier = trouverDossierSav(db, idDossierSav);
      if (dossier && !siteAutorise(request.user, dossier.siteId)) {
        reply.code(403).send(ERREUR_SITE_DOSSIER);
        return;
      }
      try {
        affecterPieceSav(db, { ...request.body, idDossierSav });
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
      const idDossierSav = Number(request.params.idDossierSav);
      const dossier = trouverDossierSav(db, idDossierSav);
      if (dossier && !siteAutorise(request.user, dossier.siteId)) {
        reply.code(403).send(ERREUR_SITE_DOSSIER);
        return;
      }
      try {
        const resultat = changerStatutSav(db, { ...request.body, idDossierSav });
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
      const idDossierSav = Number(request.params.idDossierSav);
      const dossier = trouverDossierSav(db, idDossierSav);
      // vérifié avant d'écrire le moindre fichier : sinon un dossier inexistant
      // laissait une photo orpheline sur le disque (l'insertion en base échouait ensuite)
      if (!dossier) {
        reply.code(404).send({ erreur: `Dossier SAV ${idDossierSav} introuvable` });
        return;
      }
      if (!siteAutorise(request.user, dossier.siteId)) {
        reply.code(403).send(ERREUR_SITE_DOSSIER);
        return;
      }
      try {
        // la limite par défaut du multipart (≈ 1 Mo) refusait toute photo de
        // téléphone (2 à 6 Mo) : plafond explicite, propre à cette route
        const fichier = await request.file({ limits: { fileSize: TAILLE_MAX_PHOTO_OCTETS } });
        if (!fichier) throw new Error("Aucun fichier fourni");
        const photo = enregistrerPhotoSav(db, dossierPhotos, {
          idDossierSav,
          contenu: await fichier.toBuffer(),
          nomFichierOriginal: fichier.filename,
          typeMime: fichier.mimetype,
        });
        reply.code(201).send(photo);
      } catch (erreur) {
        if ((erreur as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
          reply.code(413).send({ erreur: "La photo dépasse la taille maximale autorisée de 10 Mo" });
          return;
        }
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
      const dossier = trouverDossierSav(db, photo.idDossierSav);
      if (dossier && !siteAutorise(request.user, dossier.siteId)) {
        reply.code(403).send(ERREUR_SITE_DOSSIER);
        return;
      }
      reply.code(200).header("Content-Type", photo.typeMime).send(readFileSync(join(dossierPhotos, photo.nomFichier)));
    }
  );
}
