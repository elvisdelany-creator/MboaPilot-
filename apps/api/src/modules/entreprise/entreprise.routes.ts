import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { modifierEntreprise, trouverInfosEntrepriseParSite, type ModifierEntrepriseInput } from "./entreprise.repository.js";
import { enregistrerLogoEntreprise, resoudreTypeMimeLogo } from "./logo.service.js";
import { modifierSite } from "../utilisateurs/site.repository.js";

function envoyerErreur(reply: FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  reply.code(400).send({ erreur: message });
}

// 6.7 : identification de l'entreprise/site pour l'en-tête des documents
// commerciaux (ticket de caisse, pro-forma) — accessible à tout rôle
// authentifié, chacun devant pouvoir imprimer un document pour son site.
// 8.8 : "Paramétrage (formules, tarifs, kits, options, taxes)" regroupe le
// paramétrage catalogue (déjà ouvert au Gérant) et celui des taxes/mentions
// légales — le cahier ne distingue pas les deux ; seules l'anonymisation
// RGPD (11.3) et la licence éditeur (10.4) restent réservées à
// l'Administrateur seul.
export function registerEntrepriseRoutes(app: FastifyInstance, db: Db, dossierLogos: string, guards: { authRequis: Guard; gestionParametres: Guard }) {
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
    { preHandler: [guards.authRequis, guards.gestionParametres] },
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

  // 3.2.1, 13.2 : "personnalisation par entreprise (logo...)" sur les
  // documents commerciaux — envoi réservé à l'encadrement (8.8), comme le
  // reste du paramétrage ; consultation ouverte à tout rôle authentifié
  // (comme le reste de l'en-tête, 6.7)
  app.post("/api/v1/entreprise/logo", { preHandler: [guards.authRequis, guards.gestionParametres] }, async (request, reply) => {
    const infos = trouverInfosEntrepriseParSite(db, request.user.siteId);
    if (!infos) {
      reply.code(404).send({ erreur: "Entreprise introuvable" });
      return;
    }
    try {
      const fichier = await request.file();
      if (!fichier) throw new Error("Aucun fichier fourni");
      const entreprise = enregistrerLogoEntreprise(db, dossierLogos, {
        idEntreprise: infos.entreprise.idEntreprise,
        contenu: await fichier.toBuffer(),
        typeMime: fichier.mimetype,
      });
      reply.code(201).send(entreprise);
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });

  app.get("/api/v1/entreprise/logo", { preHandler: [guards.authRequis] }, async (request, reply) => {
    const infos = trouverInfosEntrepriseParSite(db, request.user.siteId);
    if (!infos?.entreprise.logoUrl) {
      reply.code(404).send({ erreur: "Aucun logo enregistré" });
      return;
    }
    reply.code(200).header("Content-Type", resoudreTypeMimeLogo(infos.entreprise.logoUrl)).send(readFileSync(join(dossierLogos, infos.entreprise.logoUrl)));
  });

  // 11.4, 6.7 : "Compatibilité imprimante thermique 80mm (protocole
  // ESC/POS)" — configuration de l'imprimante réseau du site de l'appelant,
  // même encadrement que le reste du paramétrage (8.8)
  app.patch<{ Body: { imprimanteHote?: string; imprimantePort?: number } }>(
    "/api/v1/site/imprimante",
    { preHandler: [guards.authRequis, guards.gestionParametres] },
    async (request, reply) => {
      const site = modifierSite(db, request.user.siteId, request.body);
      if (!site) {
        reply.code(404).send({ erreur: "Site introuvable" });
        return;
      }
      reply.code(200).send(site);
    }
  );
}
