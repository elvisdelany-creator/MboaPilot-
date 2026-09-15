import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import { trouverVerificationFacture } from "./verification.repository.js";

// 13.1 : "QR code de vérification sur factures et tickets" — endpoint
// volontairement PUBLIC (aucun guard authRequis) : c'est tout le principe
// d'un QR code scanné sans compte MboaPilot, par un client ou un tiers
// vérifiant l'authenticité d'un document papier. Le jeton opaque dans l'URL
// (facture.jeton_verification) tient lieu de secret, à la place d'une
// authentification classique.
export function registerVerificationRoutes(app: FastifyInstance, db: Db) {
  app.get<{ Params: { idFacture: string; jeton: string } }>("/api/v1/verification/factures/:idFacture/:jeton", async (request, reply) => {
    const resultat = trouverVerificationFacture(db, Number(request.params.idFacture), request.params.jeton);
    if (!resultat) {
      reply.code(404).send({ valide: false });
      return;
    }
    reply.code(200).send({ valide: true, ...resultat });
  });
}
