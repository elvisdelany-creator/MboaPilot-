import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard, RouteGuards } from "../auth/auth.plugin.js";
import { creerApporteur, listerApporteurs, modifierApporteur, type CreerApporteurInput, type ModifierApporteurInput } from "./apporteur.repository.js";
import { construireFicheApporteur } from "./apporteur.service.js";

function envoyerErreur(reply: import("fastify").FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// 6.3, 2.5.1 : gestion des apporteurs (Administrateur/Gérant) ; consultation
// de la fiche également accessible aux rôles de vente (pour choisir un
// apporteur au recrutement) ainsi qu'à l'apporteur lui-même, restreint à sa propre fiche.
export function registerApporteursRoutes(
  app: FastifyInstance,
  db: Db,
  guards: RouteGuards & { gestionApporteurs: Guard; consultationApporteurs: Guard }
) {
  app.get("/api/v1/apporteurs", { preHandler: [guards.authRequis, guards.consultationApporteurs] }, async (_request, reply) => {
    reply.code(200).send(listerApporteurs(db));
  });

  app.post<{ Body: CreerApporteurInput }>(
    "/api/v1/apporteurs",
    { preHandler: [guards.authRequis, guards.gestionApporteurs] },
    async (request, reply) => {
      try {
        reply.code(201).send(creerApporteur(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.patch<{ Params: { idApporteur: string }; Body: ModifierApporteurInput }>(
    "/api/v1/apporteurs/:idApporteur",
    { preHandler: [guards.authRequis, guards.gestionApporteurs] },
    async (request, reply) => {
      try {
        reply.code(200).send(modifierApporteur(db, Number(request.params.idApporteur), request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get<{ Params: { idApporteur: string } }>(
    "/api/v1/apporteurs/:idApporteur/fiche",
    { preHandler: [guards.authRequis, guards.consultationApporteurs] },
    async (request, reply) => {
      const idApporteur = Number(request.params.idApporteur);
      // 2.5.1 : un compte APPORTEUR ne consulte que sa propre fiche
      if (request.user.role === "APPORTEUR" && request.user.idApporteur !== idApporteur) {
        reply.code(403).send({ erreur: "Accès restreint à votre propre fiche apporteur" });
        return;
      }
      try {
        reply.code(200).send(construireFicheApporteur(db, idApporteur));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );
}
