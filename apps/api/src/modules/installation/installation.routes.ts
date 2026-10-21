import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";
import { signerSession } from "../auth/auth.plugin.js";
import { authentifier } from "../auth/auth.service.js";
import { installationNecessaire, installer, type SaisieInstallation } from "./installation.service.js";

// Routes PUBLIQUES (aucun compte n'existe encore) : l'état de l'installation, et l'installation elle-même, qui n'est
// acceptée qu'une seule fois. Elle ouvre directement la session du premier administrateur.
export function registerInstallationRoutes(app: FastifyInstance, db: Db) {
  app.get("/api/v1/installation/etat", async (_request, reply) => {
    reply.code(200).send({ installee: !installationNecessaire(db) });
  });

  app.post<{ Body: SaisieInstallation }>("/api/v1/installation", async (request, reply) => {
    if (!installationNecessaire(db)) {
      reply.code(409).send({ erreur: "L'application est déjà installée" });
      return;
    }
    try {
      const saisie = (request.body ?? {}) as SaisieInstallation;
      installer(db, saisie);
      const utilisateur = authentifier(db, saisie.administrateur.identifiant, saisie.administrateur.motDePasse);
      const token = signerSession(app, db, utilisateur.idUser);
      reply.code(201).send({ token, utilisateur });
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });
}
