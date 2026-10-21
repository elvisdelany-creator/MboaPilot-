import { createHash } from "node:crypto";
import fastifyJwt from "@fastify/jwt";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import type { Role } from "../utilisateurs/utilisateur.repository.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { idUser: number; siteId: number; role: Role; idApporteur: number | null; e?: string };
    user: { idUser: number; siteId: number; role: Role; idApporteur: number | null; e?: string };
  }
}

export type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
export interface RouteGuards {
  authRequis: Guard;
  ventes: Guard;
}

// 11.2 : un jeton sans expiration resterait valide indéfiniment (jeton volé,
// poste partagé, mot de passe réinitialisé après compromission) — une journée de
// travail laisse une session de caisse aller au bout d'un service sans coupure.
const DUREE_SESSION = "12h";

export function registerAuthPlugin(app: FastifyInstance, jwtSecret: string) {
  app.register(fastifyJwt, { secret: jwtSecret, sign: { expiresIn: DUREE_SESSION } });
}

// 11.2 : le jeton porte l'empreinte du mot de passe avec lequel il a été émis. Réinitialiser ou changer le mot de passe
// (« après compromission ») met fin à toutes les sessions ouvertes avec l'ancien : sans cela, un jeton volé restait
// exploitable jusqu'à 12 h. L'empreinte dérive du hash bcrypt, jamais du mot de passe, et n'est qu'un repère de version.
function empreinteSession(motDePasseHash: string): string {
  return createHash("sha256").update(motDePasseHash).digest("hex").slice(0, 16);
}

// signe la session d'un utilisateur : à la connexion, à l'installation et après un changement de mot de passe
export function signerSession(app: FastifyInstance, db: Db, idUser: number): string {
  const utilisateur = db.select().from(schema.utilisateur).where(eq(schema.utilisateur.idUser, idUser)).get()!;
  return app.jwt.sign({
    idUser: utilisateur.idUser,
    siteId: utilisateur.siteId,
    role: utilisateur.role,
    idApporteur: utilisateur.idApporteur,
    e: empreinteSession(utilisateur.motDePasseHash),
  });
}

// noms sous lesquels les routes acceptent aujourd'hui l'auteur d'une action
const CHAMPS_AUTEUR = ["userId", "utilisateurId"];
const METHODES_ECRITURE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
    // jeton émis avec un autre mot de passe (ou avant l'introduction de l'empreinte) : session terminée
    if (request.user.e !== empreinteSession(utilisateurCourant.motDePasseHash)) {
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
    // Un client qui n'envoie pas d'auteur n'a pas à échouer ni à laisser une action sans auteur
    // (anonymisation journalisée sans nom, annulation de paiement avec NaN) : pour toute écriture,
    // les champs d'auteur sont imposés même absents. Les lectures (GET) restent intactes.
    const ecriture = METHODES_ECRITURE.has(request.method);
    // Une écriture sans corps (ou « null ») faisait échouer les routes qui lisent request.body.xxx
    // avant leur contrôle métier : TypeError, donc « Erreur interne » (500) au lieu d'un message clair.
    if (ecriture && (request.body === undefined || request.body === null)) request.body = {};
    for (const champ of CHAMPS_AUTEUR) {
      if (request.body && typeof request.body === "object" && !Array.isArray(request.body) && (ecriture || champ in request.body)) {
        (request.body as Record<string, unknown>)[champ] = utilisateurCourant.idUser;
      }
      if (request.query && typeof request.query === "object" && (champ in request.query || (request.method === "DELETE" && champ === "userId"))) {
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
