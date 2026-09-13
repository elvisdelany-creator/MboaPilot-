import type { FastifyInstance, FastifyReply } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { imprimerTicket, type ImprimerTicketParams } from "./impression.service.js";
import type { FournisseurImpression } from "./fournisseur.js";

function envoyerErreur(reply: FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  reply.code(400).send({ erreur: message });
}

// 11.4, 6.7 : déclenche l'impression ESC/POS du ticket sur l'imprimante
// réseau du site, si une a été configurée — mêmes rôles que la vente
// (l'impression suit immédiatement l'encaissement au comptoir).
export function registerImpressionRoutes(app: FastifyInstance, db: Db, fournisseur: FournisseurImpression, guards: { authRequis: Guard; ventes: Guard }) {
  app.post<{ Body: ImprimerTicketParams["ticket"] }>(
    "/api/v1/impression/ticket",
    { preHandler: [guards.authRequis, guards.ventes] },
    async (request, reply) => {
      try {
        reply.code(200).send(await imprimerTicket(db, fournisseur, { siteId: request.user.siteId, ticket: request.body }));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
