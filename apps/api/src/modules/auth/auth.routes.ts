import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { signerSession, type Guard } from "./auth.plugin.js";
import { authentifier, changerSonMotDePasse } from "./auth.service.js";
import { messageClient } from "../../lib/erreurs-api.js";

export function registerAuthRoutes(app: FastifyInstance, db: Db, authRequis: Guard) {
  // Profil COURANT de l'appelant, relu en base : le rôle, le site et l'état du compte peuvent changer
  // pendant une session de 12 h, alors que le navigateur garde ceux reçus à la connexion. Sans jamais
  // exposer le hash du mot de passe.
  app.get("/api/v1/auth/moi", { preHandler: [authRequis] }, async (request, reply) => {
    const u = db.select().from(schema.utilisateur).where(eq(schema.utilisateur.idUser, request.user.idUser)).get()!;
    reply.code(200).send({ idUser: u.idUser, siteId: u.siteId, nom: u.nom, prenom: u.prenom, identifiant: u.identifiant, role: u.role, idApporteur: u.idApporteur });
  });

  // 11.2 : session glissante — l'application ouverte renouvelle sa session au fil de la journée (ouverture, retour sur la fenêtre,
  // toutes les 30 min), sinon un caissier connecté à 8 h était éjecté à 20 h en pleine vente et perdait son ticket. Le garde a déjà
  // vérifié le jeton, le compte actif et l'empreinte du mot de passe : un jeton expiré, un compte désactivé ou un mot de passe
  // changé depuis ne se renouvellent pas. L'identité vient du jeton, jamais du corps de la requête.
  app.post("/api/v1/auth/renouveler", { preHandler: [authRequis] }, async (request, reply) => {
    reply.code(200).send({ token: signerSession(app, db, request.user.idUser) });
  });

  // 2.5.1 : changement de SON propre mot de passe (le mot de passe actuel est revérifié) — jamais celui d'un autre :
  // l'identité vient de la session, pas du corps de la requête
  app.post<{ Body: { motDePasseActuel?: string; nouveauMotDePasse?: string } }>("/api/v1/auth/mot-de-passe", { preHandler: [authRequis] }, async (request, reply) => {
    try {
      const { motDePasseActuel, nouveauMotDePasse } = (request.body ?? {}) as { motDePasseActuel?: unknown; nouveauMotDePasse?: unknown };
      changerSonMotDePasse(db, request.user.idUser, motDePasseActuel, nouveauMotDePasse);
      // les sessions ouvertes avec l'ancien mot de passe prennent fin, y compris celle-ci : on en remet une neuve
      reply.code(200).send({ ok: true, token: signerSession(app, db, request.user.idUser) });
    } catch (erreur) {
      reply.code(400).send({ erreur: messageClient(erreur) });
    }
  });

  app.post<{ Body: { identifiant: string; motDePasse: string } }>("/api/v1/auth/login", async (request, reply) => {
    try {
      // corps absent, null ou tableau : traité comme des identifiants manquants (401 générique)
      const { identifiant, motDePasse } = (request.body ?? {}) as { identifiant?: string; motDePasse?: string };
      const utilisateur = authentifier(db, identifiant as string, motDePasse as string);
      const token = signerSession(app, db, utilisateur.idUser);
      reply.code(200).send({ token, utilisateur });
    } catch (erreur) {
      // 11.2 : propage le message réel (générique pour un échec, distinct pour un
      // compte verrouillé) — l'API ne masque plus systématiquement la raison.
      reply.code(401).send({ erreur: messageClient(erreur) });
    }
  });
}
