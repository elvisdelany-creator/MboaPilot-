import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import { authentifier } from "./auth.service.js";

export function registerAuthRoutes(app: FastifyInstance, db: Db) {
  app.post<{ Body: { identifiant: string; motDePasse: string } }>("/api/v1/auth/login", async (request, reply) => {
    try {
      const utilisateur = authentifier(db, request.body.identifiant, request.body.motDePasse);
      const token = app.jwt.sign({ idUser: utilisateur.idUser, siteId: utilisateur.siteId, role: utilisateur.role });
      reply.code(200).send({ token, utilisateur });
    } catch {
      reply.code(401).send({ erreur: "Identifiants invalides" });
    }
  });
}
