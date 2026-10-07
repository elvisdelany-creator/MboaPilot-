import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import { authentifier } from "./auth.service.js";
import { messageClient } from "../../lib/erreurs-api.js";

export function registerAuthRoutes(app: FastifyInstance, db: Db) {
  app.post<{ Body: { identifiant: string; motDePasse: string } }>("/api/v1/auth/login", async (request, reply) => {
    try {
      // corps absent, null ou tableau : traité comme des identifiants manquants (401 générique)
      const { identifiant, motDePasse } = (request.body ?? {}) as { identifiant?: string; motDePasse?: string };
      const utilisateur = authentifier(db, identifiant as string, motDePasse as string);
      const token = app.jwt.sign({
        idUser: utilisateur.idUser,
        siteId: utilisateur.siteId,
        role: utilisateur.role,
        idApporteur: utilisateur.idApporteur,
      });
      reply.code(200).send({ token, utilisateur });
    } catch (erreur) {
      // 11.2 : propage le message réel (générique pour un échec, distinct pour un
      // compte verrouillé) — l'API ne masque plus systématiquement la raison.
      reply.code(401).send({ erreur: messageClient(erreur) });
    }
  });
}
