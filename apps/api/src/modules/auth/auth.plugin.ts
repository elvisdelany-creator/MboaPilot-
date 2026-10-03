import fastifyJwt from "@fastify/jwt";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
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

// noms sous lesquels les routes acceptent aujourd'hui l'auteur d'une action
const CHAMPS_AUTEUR = ["userId", "utilisateurId"];

// 11.2 : RBAC de bout en bout — jamais appliqué uniquement côté interface.
// Le jeton ne prouve que l'identité (idUser) ; rôle, site et statut actif
// sont toujours relus en base à chaque requête, jamais fait confiance à la
// valeur figée dans le jeton — sinon désactiver un compte ou changer son
// rôle (Administration) n'aurait aucun effet tant que le jeton n'expire pas.
export function creerAuthRequis(db: Db) {
  return async function authRequis(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ erreur: "Authentification requise" });
      return;
    }

    const utilisateurCourant = db.select().from(schema.utilisateur).where(eq(schema.utilisateur.idUser, request.user.idUser)).get();
    if (!utilisateurCourant || utilisateurCourant.actif !== 1) {
      reply.code(401).send({ erreur: "Authentification requise" });
      return;
    }

    request.user = {
      idUser: utilisateurCourant.idUser,
      siteId: utilisateurCourant.siteId,
      role: utilisateurCourant.role,
      idApporteur: utilisateurCourant.idApporteur,
    };

    // 11.5 : l'auteur d'une action (journal d'audit, « créé par », paiements)
    // est toujours l'utilisateur authentifié — un userId fourni par le client,
    // dans le corps ou en paramètre, est écrasé plutôt que cru, sinon un
    // compte pourrait imputer une opération à un autre.
    for (const champ of CHAMPS_AUTEUR) {
      if (request.body && typeof request.body === "object" && champ in request.body) {
        (request.body as Record<string, unknown>)[champ] = utilisateurCourant.idUser;
      }
      if (request.query && typeof request.query === "object" && champ in request.query) {
        (request.query as Record<string, unknown>)[champ] = String(utilisateurCourant.idUser);
      }
    }
  };
}

// 2.5.2 : cloisonnement logique multi-site — un compte non-Administrateur
// n'agit jamais sur une ressource d'un site autre que le sien ; la "bascule
// de site" pour un rôle habilité à superviser plusieurs sites (ex. gérant
// multi-boutiques) est une vue dédiée différée en V2, pas une exception
// générale aux contrôles d'accès des routes métier existantes.
export function siteAutorise(utilisateur: { role: Role; siteId: number }, siteIdCible: number) {
  return utilisateur.role === "ADMINISTRATEUR" || utilisateur.siteId === siteIdCible;
}

export function exigerRole(...roles: Role[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    if (!roles.includes(request.user.role)) {
      reply.code(403).send({ erreur: "Rôle non autorisé pour cette opération" });
    }
  };
}
