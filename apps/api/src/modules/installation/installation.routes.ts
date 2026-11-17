import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";
import { signerSession } from "../auth/auth.plugin.js";
import { authentifier } from "../auth/auth.service.js";
import { installationNecessaire, installer, type SaisieInstallation } from "./installation.service.js";

// Routes PUBLIQUES (aucun compte n'existe encore) : l'état de l'installation, et l'installation elle-même, qui n'est
// acceptée qu'une seule fois. Elle ouvre directement la session du premier administrateur.
// refuserInstallation (mode hébergé) : un serveur neuf joignable depuis Internet serait pris par le premier venu qui ouvrirait l'assistant. On y
// restaure la base d'une boutique installée sur un poste local (docs/exploitation.md).
export function registerInstallationRoutes(app: FastifyInstance, db: Db, options: { refuserInstallation?: boolean } = {}) {
  app.get("/api/v1/installation/etat", async (_request, reply) => {
    reply.code(200).send({ installee: !installationNecessaire(db) });
  });

  app.post<{ Body: SaisieInstallation }>("/api/v1/installation", async (request, reply) => {
    if (options.refuserInstallation) {
      reply.code(403).send({ erreur: "L'installation est désactivée en mode hébergé : installez la boutique sur un poste local, puis restaurez sa base sur le serveur (voir docs/exploitation.md)." });
      return;
    }
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
