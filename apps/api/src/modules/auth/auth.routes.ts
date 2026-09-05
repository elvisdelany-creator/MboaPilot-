import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import { authentifier } from "./auth.service.js";

export function registerAuthRoutes(app: FastifyInstance, db: Db) {
  app.post<{ Body: { identifiant: string; motDePasse: string } }>("/api/v1/auth/login", async (request, reply) => {
    try {
      const utilisateur = authentifier(db, request.body.identifiant, request.body.motDePasse);
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
      reply.code(401).send({ erreur: erreur instanceof Error ? erreur.message : "Identifiants invalides" });
    }
  });
}
