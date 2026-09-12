import Fastify from "fastify";
import multipart from "@fastify/multipart";
import type { Db } from "./db/types.js";
import { registerAbonnementsRoutes } from "./modules/abonnements/abonnements.routes.js";
import { registerAbonnesRoutes } from "./modules/abonnes/abonnes.routes.js";
import { registerCatalogueRoutes } from "./modules/catalogue/catalogue.routes.js";
import { registerAuthPlugin, registerAuthRoutes, authRequis, exigerRole } from "./modules/auth/index.js";
import { registerJobsRoutes } from "./modules/jobs/jobs.routes.js";
import { registerProduitsRoutes } from "./modules/produits/produits.routes.js";
import { registerSavRoutes } from "./modules/sav/sav.routes.js";
import { registerApporteursRoutes } from "./modules/apporteurs/apporteurs.routes.js";
import { registerStockRoutes } from "./modules/stock/stock.routes.js";
import { registerPaiementMobileRoutes } from "./modules/paiement-mobile/paiement-mobile.routes.js";
import { SimulateurOrangeMoney } from "./modules/paiement-mobile/simulateur-orange-money.js";
import type { FournisseurPaiementMobile } from "./modules/paiement-mobile/fournisseur.js";
import { registerTableauBordRoutes } from "./modules/tableau-bord/tableau-bord.routes.js";
import { registerUtilisateursRoutes } from "./modules/utilisateurs/utilisateurs.routes.js";
import { registerEntrepriseRoutes } from "./modules/entreprise/entreprise.routes.js";
import { registerComptesPartagesRoutes } from "./modules/comptes-partages/comptes-partages.routes.js";
import { registerVentesRoutes } from "./modules/ventes/ventes.routes.js";
import { registerSauvegardeRoutes } from "./modules/sauvegarde/sauvegarde.routes.js";
import { registerAvoirRoutes } from "./modules/factures/avoir.routes.js";
import { registerLicenceRoutes } from "./modules/licence/licence.routes.js";
import { obtenirOuCreerLicence, calculerEtatLicence } from "./modules/licence/licence.service.js";
import { registerClotureCaisseRoutes } from "./modules/caisse/cloture-caisse.routes.js";

export interface BuildAppOptions {
  jwtSecret: string;
  // 6.6 : injectable pour brancher le véritable adaptateur Orange Money en
  // production, ou un fournisseur factice déterministe dans les tests —
  // par défaut le simulateur local (aucun accès réseau réel).
  fournisseurPaiementMobile?: FournisseurPaiementMobile;
  // 2.6 : dossier de destination des sauvegardes (VACUUM INTO)
  dossierSauvegardes?: string;
  // 5.10 : dossier de stockage des photos jointes aux dossiers SAV
  dossierPhotosSav?: string;
  // 3.2.1, 13.2 : dossier de stockage du logo de l'entreprise
  dossierLogos?: string;
}

// 10.4 : préfixes toujours autorisés en écriture même en mode dégradé —
// authentification (pour pouvoir se connecter et consulter), licence
// (pour revalider et sortir du mode dégradé) et sauvegarde ("export des
// données toujours possible", 10.3).
const PREFIXES_ECRITURE_TOUJOURS_AUTORISES = ["/api/v1/auth", "/api/v1/licence", "/api/v1/sauvegarde"];

export function buildApp(db: Db, options: BuildAppOptions) {
  const app = Fastify();
  registerAuthPlugin(app, options.jwtSecret);
  // 5.10 : téléversement des photos optionnelles du dossier SAV (multipart/form-data)
  app.register(multipart);
  registerAuthRoutes(app, db);
  const fournisseurPaiementMobile = options.fournisseurPaiementMobile ?? new SimulateurOrangeMoney();

  // 10.3, 10.4 : un abonnement éditeur expiré ou une revalidation périodique
  // non réussie au-delà du délai de grâce hors ligne bascule l'application
  // en mode dégradé (lecture seule) — jamais de suppression de données,
  // jamais de blocage brutal des consultations.
  app.addHook("preHandler", async (request, reply) => {
    if (request.method === "GET" || request.method === "HEAD") return;
    const chemin = request.url.split("?")[0];
    if (PREFIXES_ECRITURE_TOUJOURS_AUTORISES.some((prefixe) => chemin.startsWith(prefixe))) return;

    const licence = obtenirOuCreerLicence(db, new Date().toISOString());
    const { etat } = calculerEtatLicence(licence, new Date().toISOString());
    if (etat === "DEGRADE") {
      reply.code(403).send({ message: "Licence éditeur expirée : application en mode dégradé (lecture seule). Contactez votre éditeur pour réactiver l'abonnement." });
    }
  });

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
  // 5.2 : mouvements correctifs de stock (achat, casse, inventaire) réservés à
  // l'encadrement — "validation par un rôle habilité" pour l'ajustement d'inventaire
  const gestionStock = exigerRole("ADMINISTRATEUR", "GERANT");
  // 8.2 : création/édition des fiches article réservée à l'encadrement
  const gestionCatalogue = exigerRole("ADMINISTRATEUR", "GERANT");
  // 8.1 : fusion de doublons — opération destructrice, réservée à l'encadrement
  const fusionAbonnes = exigerRole("ADMINISTRATEUR", "GERANT");
  // 8.6, 9.3 : indicateurs financiers du tableau de bord — vue Administrateur/
  // Gérant/Comptable, distincte des alertes d'échéance/stock ouvertes aux ventes
  const pilotage = exigerRole("ADMINISTRATEUR", "GERANT", "COMPTABLE");
  // 5.9 : création/édition des comptes partagés streaming réservée à l'encadrement
  const gestionComptesPartages = exigerRole("ADMINISTRATEUR", "GERANT");
  // 6.4 : émission d'un avoir — correction financière, réservée à l'encadrement
  const gestionAvoirs = exigerRole("ADMINISTRATEUR", "GERANT");
  // 13.1 : "validation par un rôle habilité" pour la fermeture de caisse — encadrement uniquement
  const validationCloture = exigerRole("ADMINISTRATEUR", "GERANT");

  registerAbonnementsRoutes(app, db, { authRequis, ventes });
  // 11.3 : anonymisation (droit de suppression) réservée à l'Administrateur seul
  registerAbonnesRoutes(app, db, { authRequis, ventes, fusionAbonnes, anonymisationAbonne: admin });
  registerCatalogueRoutes(app, db, { authRequis, gestionCatalogue });
  registerJobsRoutes(app, db, { authRequis, ventes, admin });
  registerProduitsRoutes(app, db, { authRequis, ventes, gestionCatalogue });
  registerSavRoutes(app, db, options.dossierPhotosSav ?? "./data/sav-photos", { authRequis, ventes, sav });
  registerApporteursRoutes(app, db, { authRequis, ventes, gestionApporteurs, consultationApporteurs });
  registerStockRoutes(app, db, { authRequis, ventes, gestionStock });
  registerPaiementMobileRoutes(app, db, fournisseurPaiementMobile, { authRequis, ventes });
  registerTableauBordRoutes(app, db, { authRequis, ventes, pilotage });
  registerUtilisateursRoutes(app, db, { authRequis, admin });
  registerEntrepriseRoutes(app, db, options.dossierLogos ?? "./data/logos", { authRequis, admin });
  registerComptesPartagesRoutes(app, db, { authRequis, ventes, gestionComptesPartages });
  // 5.2, 5.3, 8.5 : vente rapide de produits/services hors abonnement
  registerVentesRoutes(app, db, { authRequis, ventes });
  // 2.6 : sauvegardes et export manuel des données
  registerSauvegardeRoutes(app, db, options.dossierSauvegardes ?? "./data/backups", { authRequis, admin });
  // 6.4 : correction d'une facture VALIDEE par avoir
  registerAvoirRoutes(app, db, { authRequis, ventes, gestionAvoirs });
  // 10.4 : état de la licence éditeur, consultable par tout utilisateur connecté
  registerLicenceRoutes(app, db, { authRequis });
  // 13.1 : clôture de caisse quotidienne (fond d'ouverture, comptage, écart théorique/réel)
  registerClotureCaisseRoutes(app, db, { authRequis, ventes, validationCloture });

  return app;
}
