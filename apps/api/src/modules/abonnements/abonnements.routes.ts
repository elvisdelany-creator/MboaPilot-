import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import type { RouteGuards } from "../auth/auth.plugin.js";
import { siteAutorise } from "../auth/auth.plugin.js";
import { trouverAbonne } from "../abonnes/abonne.repository.js";
import { recruterAbonne, type RecruterAbonneParams } from "./recrutement.service.js";
import { reabonner, type ReabonnerParams } from "./reabonnement.service.js";
import { echangerMateriel, type EchangerMaterielParams } from "./echange-materiel.service.js";
import { changerFormule, type ChangerFormuleParams } from "./changement-formule.service.js";
import { listerAbonnementsParAbonne } from "./abonnement.repository.js";

const ERREUR_SITE_ABONNE = { erreur: "Cet abonné n'appartient pas à votre site" };
const ERREUR_SITE_ABONNEMENT = { erreur: "Cet abonnement n'appartient pas à votre site" };

type Appelant = Parameters<typeof siteAutorise>[0];

// 2.5.2 : un compte non-Administrateur n'agit jamais sur un abonné ou un
// abonnement d'un autre site (liste, recrutement, renouvellement, migration,
// échange) — sinon la facture serait comptabilisée sur le site de l'appelant
// pour un client d'un autre. Une ressource inconnue n'est pas refusée ici : le
// service la signale en 404.
function abonneAutreSite(db: Db, appelant: Appelant, idAbonne: number) {
  const abonne = trouverAbonne(db, idAbonne);
  return abonne !== undefined && !siteAutorise(appelant, abonne.siteId);
}

function abonnementAutreSite(db: Db, appelant: Appelant, numeroAbonnement: number) {
  const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get();
  return abonnement !== undefined && !siteAutorise(appelant, abonnement.siteId);
}

// 11.2 : les opérations de vente (recrutement, réabonnement) sont réservées aux
// rôles habilités à encaisser — cohérent avec le périmètre de l'écran de caisse.
export function registerAbonnementsRoutes(app: FastifyInstance, db: Db, guards: RouteGuards) {
  app.get<{ Params: { idAbonne: string } }>(
    "/api/v1/abonnes/:idAbonne/abonnements",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      const idAbonne = Number(request.params.idAbonne);
      if (abonneAutreSite(db, request.user, idAbonne)) {
        reply.code(403).send(ERREUR_SITE_ABONNE);
        return;
      }
      reply.code(200).send(listerAbonnementsParAbonne(db, idAbonne));
    }
  );

  app.post<{ Body: RecruterAbonneParams }>(
    "/api/v1/recrutements",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      if (!request.body?.abonne || typeof request.body.abonne !== "object") {
        reply.code(400).send({ erreur: "Les informations de l'abonné sont obligatoires" });
        return;
      }
      if ("idAbonne" in request.body.abonne && abonneAutreSite(db, request.user, request.body.abonne.idAbonne)) {
        reply.code(403).send(ERREUR_SITE_ABONNE);
        return;
      }
      try {
        // 2.5.2 : le siteId du corps n'est qu'une indication client — celui de
        // l'appelant (relu en base à chaque requête) fait seul foi
        const resultat = recruterAbonne(db, { ...request.body, siteId: request.user.siteId });
        reply.code(201).send(resultat);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { numeroAbonnement: string }; Body: Omit<ReabonnerParams, "numeroAbonnement"> }>(
    "/api/v1/abonnements/:numeroAbonnement/reabonnements",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      if (abonnementAutreSite(db, request.user, Number(request.params.numeroAbonnement))) {
        reply.code(403).send(ERREUR_SITE_ABONNEMENT);
        return;
      }
      try {
        const resultat = reabonner(db, {
          ...request.body,
          siteId: request.user.siteId,
          numeroAbonnement: Number(request.params.numeroAbonnement),
        });
        reply.code(200).send(resultat);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { numeroAbonnement: string }; Body: Omit<EchangerMaterielParams, "numeroAbonnement"> }>(
    "/api/v1/abonnements/:numeroAbonnement/echange-materiel",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      if (abonnementAutreSite(db, request.user, Number(request.params.numeroAbonnement))) {
        reply.code(403).send(ERREUR_SITE_ABONNEMENT);
        return;
      }
      try {
        const resultat = echangerMateriel(db, {
          ...request.body,
          siteId: request.user.siteId,
          numeroAbonnement: Number(request.params.numeroAbonnement),
        });
        reply.code(201).send(resultat);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Params: { numeroAbonnement: string }; Body: Omit<ChangerFormuleParams, "numeroAbonnement"> }>(
    "/api/v1/abonnements/:numeroAbonnement/changement-formule",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      if (abonnementAutreSite(db, request.user, Number(request.params.numeroAbonnement))) {
        reply.code(403).send(ERREUR_SITE_ABONNEMENT);
        return;
      }
      try {
        const resultat = changerFormule(db, {
          ...request.body,
          siteId: request.user.siteId,
          numeroAbonnement: Number(request.params.numeroAbonnement),
        });
        reply.code(200).send(resultat);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}
