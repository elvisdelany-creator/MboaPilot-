import Fastify from "fastify";
import type { Db } from "./db/types.js";
import { registerAbonnementsRoutes } from "./modules/abonnements/abonnements.routes.js";
import { registerAbonnesRoutes } from "./modules/abonnes/abonnes.routes.js";
import { registerCatalogueRoutes } from "./modules/catalogue/catalogue.routes.js";
import { registerAuthPlugin, registerAuthRoutes, authRequis, exigerRole } from "./modules/auth/index.js";
import { registerJobsRoutes } from "./modules/jobs/jobs.routes.js";

export interface BuildAppOptions {
  jwtSecret: string;
}

export function buildApp(db: Db, options: BuildAppOptions) {
  const app = Fastify();
  registerAuthPlugin(app, options.jwtSecret);
  registerAuthRoutes(app, db);

  // 2.5.1 : seuls Administrateur, Gérant et Caissier peuvent réaliser une vente
  const ventes = exigerRole("ADMINISTRATEUR", "GERANT", "CAISSIER");
  const admin = exigerRole("ADMINISTRATEUR");

  registerAbonnementsRoutes(app, db, { authRequis, ventes });
  registerAbonnesRoutes(app, db, { authRequis, ventes });
  registerCatalogueRoutes(app, db, { authRequis });
  registerJobsRoutes(app, db, { authRequis, ventes, admin });

  return app;
}
