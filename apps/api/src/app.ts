import Fastify from "fastify";
import type { Db } from "./db/types.js";
import { registerAbonnementsRoutes } from "./modules/abonnements/abonnements.routes.js";
import { registerAbonnesRoutes } from "./modules/abonnes/abonnes.routes.js";
import { registerCatalogueRoutes } from "./modules/catalogue/catalogue.routes.js";
import { registerAuthPlugin, registerAuthRoutes, authRequis, exigerRole } from "./modules/auth/index.js";
import { registerJobsRoutes } from "./modules/jobs/jobs.routes.js";
import { registerProduitsRoutes } from "./modules/produits/produits.routes.js";
import { registerSavRoutes } from "./modules/sav/sav.routes.js";
import { registerApporteursRoutes } from "./modules/apporteurs/apporteurs.routes.js";

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
  // 2.5.1, 8.4 : réception au comptoir (Administrateur/Gérant/Caissier) ou Technicien SAV
  const sav = exigerRole("ADMINISTRATEUR", "GERANT", "CAISSIER", "TECHNICIEN_SAV");
  // 6.3 : gestion des apporteurs réservée à l'encadrement
  const gestionApporteurs = exigerRole("ADMINISTRATEUR", "GERANT");
  // consultation : rôles de vente (choix d'un apporteur au recrutement) + l'apporteur
  // lui-même (restriction à sa propre fiche vérifiée dans la route, 2.5.1)
  const consultationApporteurs = exigerRole("ADMINISTRATEUR", "GERANT", "CAISSIER", "APPORTEUR");

  registerAbonnementsRoutes(app, db, { authRequis, ventes });
  registerAbonnesRoutes(app, db, { authRequis, ventes });
  registerCatalogueRoutes(app, db, { authRequis });
  registerJobsRoutes(app, db, { authRequis, ventes, admin });
  registerProduitsRoutes(app, db, { authRequis });
  registerSavRoutes(app, db, { authRequis, ventes, sav });
  registerApporteursRoutes(app, db, { authRequis, ventes, gestionApporteurs, consultationApporteurs });

  return app;
}
