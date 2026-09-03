import type { FastifyInstance, FastifyReply } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { modifierEntreprise, trouverInfosEntrepriseParSite, type ModifierEntrepriseInput } from "./entreprise.repository.js";

function envoyerErreur(reply: FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  reply.code(400).send({ erreur: message });
}

// 6.7 : identification de l'entreprise/site pour l'en-tête des documents
// commerciaux (ticket de caisse, pro-forma) — accessible à tout rôle
// authentifié, chacun devant pouvoir imprimer un document pour son site.
// L'édition du taux de TVA et des mentions légales (6.1, 8.8) est réservée à
// l'Administrateur, comme le reste du paramétrage.
export function registerEntrepriseRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; admin: Guard }) {
  app.get("/api/v1/entreprise", { preHandler: [guards.authRequis] }, async (request, reply) => {
    const infos = trouverInfosEntrepriseParSite(db, request.user.siteId);
    if (!infos) {
      reply.code(404).send({ erreur: "Entreprise introuvable" });
      return;
    }
    reply.code(200).send(infos);
  });

  app.patch<{ Body: ModifierEntrepriseInput }>(
    "/api/v1/entreprise",
    { preHandler: [guards.authRequis, guards.admin] },
    async (request, reply) => {
      const infosActuelles = trouverInfosEntrepriseParSite(db, request.user.siteId);
      if (!infosActuelles) {
        reply.code(404).send({ erreur: "Entreprise introuvable" });
        return;
      }
      try {
        const entreprise = modifierEntreprise(db, infosActuelles.entreprise.idEntreprise, request.body);
        reply.code(200).send(entreprise);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
