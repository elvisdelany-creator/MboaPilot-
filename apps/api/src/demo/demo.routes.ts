import type { FastifyInstance } from "fastify";
import { COMPTES_DEMO } from "./mode-demo.js";

// Route PUBLIQUE (l'écran de connexion l'interroge avant toute session) : annonce la démo et ses comptes partagés, pour que le visiteur
// puisse se connecter en un clic. Hors démo, elle répond seulement { actif: false } : jamais un compte.
export function registerDemoRoutes(app: FastifyInstance, modeDemo: boolean) {
  app.get("/api/v1/demo", async (_request, reply) => {
    if (!modeDemo) {
      reply.code(200).send({ actif: false });
      return;
    }
    reply.code(200).send({ actif: true, comptes: COMPTES_DEMO.map(({ role, libelle, identifiant, motDePasse }) => ({ role, libelle, identifiant, motDePasse })) });
  });

  // DIAGNOSTIC TEMPORAIRE, démo seulement : les en-têtes d'adresse tels que le serveur les reçoit derrière le proxy de l'hébergeur, pour fixer
  // le réglage sur des faits (voir adresse-visiteur.ts). Ne renvoie que ces en-têtes, jamais d'autorisation ni de cookie. À retirer ensuite.
  if (modeDemo) {
    app.get("/api/v1/demo/diagnostic-proxy", async (request, reply) => {
      const entete = (nom: string) => {
        const v = request.headers[nom];
        return Array.isArray(v) ? v.join(", ") : (v ?? null);
      };
      reply.code(200).send({
        adresseConnexion: request.ip,
        xForwardedFor: entete("x-forwarded-for"),
        xForwardedProto: entete("x-forwarded-proto"),
        cfConnectingIp: entete("cf-connecting-ip"),
        trueClientIp: entete("true-client-ip"),
        xRealIp: entete("x-real-ip"),
        forwarded: entete("forwarded"),
      });
    });
  }
}
