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
}
