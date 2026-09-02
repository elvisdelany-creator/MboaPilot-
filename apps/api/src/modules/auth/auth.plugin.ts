import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "../utilisateurs/utilisateur.repository.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { idUser: number; siteId: number; role: Role; idApporteur: number | null };
    user: { idUser: number; siteId: number; role: Role; idApporteur: number | null };
  }
}

export type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
export interface RouteGuards {
  authRequis: Guard;
  ventes: Guard;
}

export function registerAuthPlugin(app: FastifyInstance, jwtSecret: string) {
  app.register(fastifyJwt, { secret: jwtSecret });
}

// 11.2 : RBAC de bout en bout — jamais appliqué uniquement côté interface
export async function authRequis(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ erreur: "Authentification requise" });
  }
}

export function exigerRole(...roles: Role[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!roles.includes(request.user.role)) {
      reply.code(403).send({ erreur: "Rôle non autorisé pour cette opération" });
    }
  };
}
