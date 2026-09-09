import type { FastifyInstance, FastifyReply } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { creerUtilisateur, listerUtilisateurs, modifierUtilisateur, type CreerUtilisateurInput, type ModifierUtilisateurInput } from "./utilisateur.repository.js";
import { creerSite, listerSites, modifierSite, trouverSite, type CreerSiteInput, type ModifierSiteInput } from "./site.repository.js";
import { listerJournalAudit } from "./audit.repository.js";

function envoyerErreur(reply: FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

type CreerUtilisateurBody = Omit<CreerUtilisateurInput, "siteId"> & { siteId?: number };
type CreerSiteBody = Omit<CreerSiteInput, "idEntreprise">;

// 8.7, 2.5.1, 11.5 : gestion des comptes utilisateurs, des sites de
// l'entreprise et consultation du journal d'audit — réservé à
// l'Administrateur. La vue de supervision multi-site avec bascule entre
// sites (2.5.2) est différée en V2 (12.1) : ici, un administrateur gère les
// comptes et le site auquel il est lui-même rattaché.
export function registerUtilisateursRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; admin: Guard }) {
  app.get("/api/v1/utilisateurs", { preHandler: [guards.authRequis, guards.admin] }, async (request, reply) => {
    reply.code(200).send(listerUtilisateurs(db, request.user.siteId));
  });

  app.post<{ Body: CreerUtilisateurBody }>(
    "/api/v1/utilisateurs",
    { preHandler: [guards.authRequis, guards.admin] },
    async (request, reply) => {
      try {
        const siteId = request.body.siteId ?? request.user.siteId;
        if (!trouverSite(db, siteId)) throw new Error(`Site ${siteId} introuvable`);
        const { motDePasseHash: _motDePasseHash, ...utilisateur } = creerUtilisateur(db, { ...request.body, siteId }, request.user.idUser);
        reply.code(201).send(utilisateur);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.patch<{ Params: { idUser: string }; Body: ModifierUtilisateurInput }>(
    "/api/v1/utilisateurs/:idUser",
    { preHandler: [guards.authRequis, guards.admin] },
    async (request, reply) => {
      const idUser = Number(request.params.idUser);
      // 2.5.1 : un administrateur ne peut pas se désactiver lui-même — évite
      // qu'un site se retrouve sans compte habilité à administrer
      if (idUser === request.user.idUser && request.body.actif === false) {
        reply.code(400).send({ erreur: "Impossible de désactiver votre propre compte" });
        return;
      }
      try {
        const utilisateur = modifierUtilisateur(db, idUser, request.body, request.user.idUser);
        if (!utilisateur) throw new Error(`Utilisateur ${idUser} introuvable`);
        reply.code(200).send(utilisateur);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get("/api/v1/sites", { preHandler: [guards.authRequis, guards.admin] }, async (request, reply) => {
    const siteAppelant = trouverSite(db, request.user.siteId);
    if (!siteAppelant) {
      reply.code(404).send({ erreur: "Site introuvable" });
      return;
    }
    reply.code(200).send(listerSites(db, siteAppelant.idEntreprise));
  });

  app.post<{ Body: CreerSiteBody }>("/api/v1/sites", { preHandler: [guards.authRequis, guards.admin] }, async (request, reply) => {
    try {
      const siteAppelant = trouverSite(db, request.user.siteId);
      if (!siteAppelant) throw new Error("Site introuvable");
      reply.code(201).send(creerSite(db, { ...request.body, idEntreprise: siteAppelant.idEntreprise }));
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });

  app.patch<{ Params: { idSite: string }; Body: ModifierSiteInput }>(
    "/api/v1/sites/:idSite",
    { preHandler: [guards.authRequis, guards.admin] },
    async (request, reply) => {
      try {
        const site = modifierSite(db, Number(request.params.idSite), request.body);
        if (!site) throw new Error(`Site ${request.params.idSite} introuvable`);
        reply.code(200).send(site);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get<{ Querystring: { tableCible?: string } }>(
    "/api/v1/audit",
    { preHandler: [guards.authRequis, guards.admin] },
    async (request, reply) => {
      reply.code(200).send(listerJournalAudit(db, { tableCible: request.query.tableCible }));
    }
  );
}
