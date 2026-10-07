import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { RouteGuards, Guard } from "../auth/auth.plugin.js";
import { siteAutorise } from "../auth/auth.plugin.js";
import * as schema from "../../db/schema.js";
import { creerAvoir, listerLignesFacture, type LigneAvoirInput } from "./avoir.service.js";
import { encaisserSoldeFacture, type EncaisserSoldeParams } from "./paiement-complementaire.service.js";
import { annulerPaiement } from "./annulation-paiement.service.js";
import { confirmerRapprochementVirement } from "./paiement.repository.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";

const ERREUR_SITE_FACTURE = { erreur: "Cette facture n'appartient pas à votre site" };
const ERREUR_SITE_PAIEMENT = { erreur: "Ce paiement n'appartient pas à votre site" };

// 6.4 : émission d'un avoir — correction d'une facture VALIDEE, réservée à
// l'encadrement (opération financière correctrice, comme la fusion de doublons).
// 2.5.1 : la consultation des lignes reste ouverte au Comptable (lecture financière).
export function registerAvoirRoutes(app: FastifyInstance, db: Db, guards: RouteGuards & { gestionAvoirs: Guard; lectureFinanciere: Guard; gestionRapprochement: Guard }) {
  app.get<{ Params: { idFacture: string } }>(
    "/api/v1/factures/:idFacture/lignes",
    { preHandler: [guards.authRequis, guards.lectureFinanciere] },
    async (request, reply) => {
      const idFacture = Number(request.params.idFacture);
      const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
      if (facture && !siteAutorise(request.user, facture.siteId)) {
        reply.code(403).send(ERREUR_SITE_FACTURE);
        return;
      }
      reply.code(200).send(listerLignesFacture(db, idFacture));
    }
  );

  app.post<{ Params: { idFacture: string }; Body: { lignes: LigneAvoirInput[]; restituerStock: boolean; userId: number } }>(
    "/api/v1/factures/:idFacture/avoir",
    { preHandler: [guards.authRequis, guards.gestionAvoirs] },
    async (request, reply) => {
      const idFactureOrigine = Number(request.params.idFacture);
      const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFactureOrigine)).get();
      if (facture && !siteAutorise(request.user, facture.siteId)) {
        reply.code(403).send(ERREUR_SITE_FACTURE);
        return;
      }
      try {
        reply.code(201).send(
          creerAvoir(db, {
            idFactureOrigine,
            lignes: request.body.lignes,
            restituerStock: request.body.restituerStock,
            userId: request.body.userId,
          })
        );
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  // 6.4 point 5, 9.4 : encaissement complémentaire sur le solde restant dû
  // d'une facture — mêmes rôles que pour un encaissement initial (2.5.1)
  app.post<{ Params: { idFacture: string }; Body: Omit<EncaisserSoldeParams, "idFacture"> }>(
    "/api/v1/factures/:idFacture/paiements",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      const idFacture = Number(request.params.idFacture);
      const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
      if (facture && !siteAutorise(request.user, facture.siteId)) {
        reply.code(403).send(ERREUR_SITE_FACTURE);
        return;
      }
      try {
        reply.code(201).send(encaisserSoldeFacture(db, { ...request.body, idFacture }));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  // 9.1, 11.5 : "Aucune opération destructrice (suppression de vente,
  // annulation de paiement) sans confirmation et sans traçabilité" —
  // réservée à l'encadrement, comme l'émission d'un avoir (correction financière)
  app.delete<{ Params: { idPaiement: string }; Querystring: { userId: string } }>(
    "/api/v1/paiements/:idPaiement",
    { preHandler: [guards.authRequis, guards.gestionAvoirs] },
    async (request, reply) => {
      const idPaiement = Number(request.params.idPaiement);
      const paiement = db.select().from(schema.paiement).where(eq(schema.paiement.idPaiement, idPaiement)).get();
      if (paiement) {
        const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, paiement.idFacture)).get();
        if (facture && !siteAutorise(request.user, facture.siteId)) {
          reply.code(403).send(ERREUR_SITE_PAIEMENT);
          return;
        }
      }
      try {
        reply.code(200).send(annulerPaiement(db, { idPaiement, userId: Number(request.query.userId) }));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  // 6.5 : "Virement bancaire — Différée (rapprochement)" — confirmation
  // manuelle une fois le relevé bancaire vérifié, réservée aux rôles
  // financiers (comme le pilotage financier du tableau de bord, 8.6/9.3)
  app.patch<{ Params: { idPaiement: string } }>(
    "/api/v1/paiements/:idPaiement/rapprochement",
    { preHandler: [guards.authRequis, guards.gestionRapprochement] },
    async (request, reply) => {
      const idPaiement = Number(request.params.idPaiement);
      const paiement = db.select().from(schema.paiement).where(eq(schema.paiement.idPaiement, idPaiement)).get();
      if (paiement) {
        const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, paiement.idFacture)).get();
        if (facture && !siteAutorise(request.user, facture.siteId)) {
          reply.code(403).send(ERREUR_SITE_PAIEMENT);
          return;
        }
      }
      try {
        reply.code(200).send(confirmerRapprochementVirement(db, idPaiement));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
