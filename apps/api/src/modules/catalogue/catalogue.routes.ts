import type { FastifyInstance, FastifyReply } from "fastify";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import {
  creerFamille,
  creerFormule,
  creerKit,
  creerOption,
  definirPrixDecodeurKit,
  delierOptionFormule,
  lierOptionFormule,
  listerCatalogue,
  listerFamilles,
  listerFormules,
  listerKits,
  listerOptions,
  modifierFormule,
  modifierKit,
  modifierOption,
  supprimerPrixDecodeurKit,
  type CreerFamilleInput,
  type CreerFormuleInput,
  type CreerKitInput,
  type CreerOptionInput,
  type DefinirPrixDecodeurInput,
  type LierOptionFormuleInput,
  type ModifierFormuleInput,
  type ModifierKitInput,
  type ModifierOptionInput,
} from "./catalogue.repository.js";

function envoyerErreur(reply: FastifyReply, erreur: unknown) {
  const message = erreur instanceof Error ? erreur.message : "Erreur inconnue";
  const statut = /introuvable/i.test(message) ? 404 : 400;
  reply.code(statut).send({ erreur: message });
}

// catalogue en lecture : accessible à tout utilisateur authentifié, quel que
// soit son rôle. Le back-office (8.8 : familles, formules, options, kits —
// sans intervention développeur) est réservé à l'encadrement (gestionCatalogue,
// même guard que la fiche article — 8.2).
export function registerCatalogueRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; gestionCatalogue: Guard }) {
  app.get("/api/v1/catalogue", { preHandler: [guards.authRequis] }, async (_request, reply) => {
    reply.code(200).send(listerCatalogue(db));
  });

  app.get("/api/v1/catalogue/familles", { preHandler: [guards.authRequis] }, async (_request, reply) => {
    reply.code(200).send(listerFamilles(db));
  });

  app.post<{ Body: CreerFamilleInput }>(
    "/api/v1/catalogue/familles",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        reply.code(201).send(creerFamille(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  // 8.8 : toutes les formules d'une famille (y compris désactivées), pour le
  // back-office — réservé à l'encadrement, à la différence de /catalogue
  // (filtré actif = 1 pour la vente, ouvert à tout rôle authentifié)
  app.get<{ Querystring: { idFamille: string } }>(
    "/api/v1/catalogue/formules",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      reply.code(200).send(listerFormules(db, Number(request.query.idFamille)));
    }
  );

  app.post<{ Body: CreerFormuleInput }>(
    "/api/v1/catalogue/formules",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        reply.code(201).send(creerFormule(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.patch<{ Params: { idFormule: string }; Body: ModifierFormuleInput }>(
    "/api/v1/catalogue/formules/:idFormule",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        const formule = modifierFormule(db, Number(request.params.idFormule), request.body);
        if (!formule) throw new Error(`Formule ${request.params.idFormule} introuvable`);
        reply.code(200).send(formule);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.get("/api/v1/catalogue/options", { preHandler: [guards.authRequis] }, async (_request, reply) => {
    reply.code(200).send(listerOptions(db));
  });

  app.post<{ Body: CreerOptionInput }>(
    "/api/v1/catalogue/options",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        reply.code(201).send(creerOption(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.patch<{ Params: { idOption: string }; Body: ModifierOptionInput }>(
    "/api/v1/catalogue/options/:idOption",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        const option = modifierOption(db, Number(request.params.idOption), request.body);
        if (!option) throw new Error(`Option ${request.params.idOption} introuvable`);
        reply.code(200).send(option);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Body: LierOptionFormuleInput }>(
    "/api/v1/catalogue/options/compat",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        reply.code(200).send(lierOptionFormule(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.delete<{ Params: { idFormule: string; idOption: string } }>(
    "/api/v1/catalogue/options/:idOption/compat/:idFormule",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      delierOptionFormule(db, Number(request.params.idFormule), Number(request.params.idOption));
      reply.code(204).send();
    }
  );

  // 5.1.1, 8.8 : back-office des kits (règles de prix dynamique) — réservé à
  // l'encadrement, comme les formules
  app.get<{ Querystring: { idFamille: string } }>(
    "/api/v1/catalogue/kits",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      reply.code(200).send(listerKits(db, Number(request.query.idFamille)));
    }
  );

  app.post<{ Body: CreerKitInput }>(
    "/api/v1/catalogue/kits",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        reply.code(201).send(creerKit(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.patch<{ Params: { idKit: string }; Body: ModifierKitInput }>(
    "/api/v1/catalogue/kits/:idKit",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        const kit = modifierKit(db, Number(request.params.idKit), request.body);
        if (!kit) throw new Error(`Kit ${request.params.idKit} introuvable`);
        reply.code(200).send(kit);
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.post<{ Body: DefinirPrixDecodeurInput }>(
    "/api/v1/catalogue/kits/prix-decodeur",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      try {
        reply.code(200).send(definirPrixDecodeurKit(db, request.body));
      } catch (erreur) {
        envoyerErreur(reply, erreur);
      }
    }
  );

  app.delete<{ Params: { idKit: string; idFormule: string } }>(
    "/api/v1/catalogue/kits/:idKit/prix-decodeur/:idFormule",
    { preHandler: [guards.authRequis, guards.gestionCatalogue] },
    async (request, reply) => {
      supprimerPrixDecodeurKit(db, Number(request.params.idKit), Number(request.params.idFormule));
      reply.code(204).send();
    }
  );
}
