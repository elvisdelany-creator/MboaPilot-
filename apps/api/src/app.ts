import Fastify from "fastify";
import { gestionnaireErreurFastify, gestionnaireRouteInconnue } from "./lib/erreurs-api.js";
import { creerGestionnaireInterfaceWeb } from "./lib/interface-web.js";
import multipart from "@fastify/multipart";
import type { Db } from "./db/types.js";
import { registerAbonnementsRoutes } from "./modules/abonnements/abonnements.routes.js";
import { registerAbonnesRoutes } from "./modules/abonnes/abonnes.routes.js";
import { registerCatalogueRoutes } from "./modules/catalogue/catalogue.routes.js";
import { registerAuthPlugin, registerAuthRoutes, creerAuthRequis, exigerRole } from "./modules/auth/index.js";
import { registerJobsRoutes } from "./modules/jobs/jobs.routes.js";
import { registerProduitsRoutes } from "./modules/produits/produits.routes.js";
import { registerSavRoutes } from "./modules/sav/sav.routes.js";
import { registerApporteursRoutes } from "./modules/apporteurs/apporteurs.routes.js";
import { registerStockRoutes } from "./modules/stock/stock.routes.js";
import { registerPaiementMobileRoutes } from "./modules/paiement-mobile/paiement-mobile.routes.js";
import { SimulateurOrangeMoney } from "./modules/paiement-mobile/simulateur-orange-money.js";
import type { FournisseurPaiementMobile } from "./modules/paiement-mobile/fournisseur.js";
import { registerTableauBordRoutes } from "./modules/tableau-bord/tableau-bord.routes.js";
import { registerExportComptableRoutes } from "./modules/export-comptable/export-comptable.routes.js";
import { registerUtilisateursRoutes } from "./modules/utilisateurs/utilisateurs.routes.js";
import { registerEntrepriseRoutes } from "./modules/entreprise/entreprise.routes.js";
import { registerComptesPartagesRoutes } from "./modules/comptes-partages/comptes-partages.routes.js";
import { registerVentesRoutes } from "./modules/ventes/ventes.routes.js";
import { registerSauvegardeRoutes } from "./modules/sauvegarde/sauvegarde.routes.js";
import { registerAvoirRoutes } from "./modules/factures/avoir.routes.js";
import { registerLicenceRoutes } from "./modules/licence/licence.routes.js";
import { registerInstallationRoutes } from "./modules/installation/installation.routes.js";
import { obtenirOuCreerLicence, calculerEtatLicence } from "./modules/licence/licence.service.js";
import { messageModeDegrade } from "@mboapilot/shared";
import { registerClotureCaisseRoutes } from "./modules/caisse/cloture-caisse.routes.js";
import { registerImpressionRoutes } from "./modules/impression/impression.routes.js";
import { registerVerificationRoutes } from "./modules/verification/verification.routes.js";
import { ImprimanteReseauTcp } from "./modules/impression/imprimante-reseau-tcp.js";
import type { FournisseurImpression } from "./modules/impression/fournisseur.js";
import { dossierLogos, dossierPhotosSav, dossierSauvegardes } from "./config/chemins.js";
import { ecritureBloqueeEnDemo, estTeleversement, MESSAGE_FONCTION_DESACTIVEE_EN_DEMO } from "./demo/mode-demo.js";
import { creerLimiteurDebit, type ConfigurationLimite } from "./demo/limiteur-debit.js";
import { registerDemoRoutes } from "./demo/demo.routes.js";
import { adresseDuVisiteur, protocoleAnnonce } from "./demo/adresse-visiteur.js";

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
  // 11.4 : injectable pour brancher un double de test (aucune imprimante
  // réelle nécessaire) — par défaut l'implémentation réseau réelle, inerte
  // tant qu'aucun site ne configure d'hôte d'imprimante.
  fournisseurImpression?: FournisseurImpression;
  // dossier de l'interface web construite (apps/web/dist) : si présent, l'API la sert elle-même, sur la même adresse
  dossierInterfaceWeb?: string;
  // démo publique : refuse les écritures sensibles (comptes, mots de passe, licence, sauvegardes…), ne verrouille jamais un compte partagé et
  // plafonne le débit par adresse. Jamais sur la vraie base d'une boutique (voir demo/mode-demo.ts).
  modeDemo?: boolean;
  // derrière un proxy HTTPS de confiance (hébergeur) : nombre de proxys successifs dont on croit l'en-tête X-Forwarded-For (true = 1). Chacun
  // AJOUTE l'adresse qu'il voit à droite de l'en-tête, sans retirer ce que le visiteur y a mis : seules les adresses de droite sont fiables,
  // et on ne remonte que de ce nombre de proxys (jamais « tous », qui retiendrait l'adresse inventée par le visiteur et contournerait le
  // plafond de débit). Sans proxy, l'en-tête est ignoré.
  faireConfianceAuProxy?: boolean | number;
  // plafonds de requêtes par adresse sur /api/ : général, et connexions (plus sévère). Par défaut, ceux de la démo ; absents hors démo.
  limiteDebit?: { generale: ConfigurationLimite; connexion: ConfigurationLimite; televersement: ConfigurationLimite };
}

// démo publique : un caissier qui travaille fait quelques dizaines d'appels par minute ; ces plafonds laissent de la marge à un visiteur
// qui explore, mais arrêtent un script
// (les envois de fichiers écrivent sur le disque, souvent petit et éphémère, d'un hébergement gratuit : plafond bien plus bas)
const LIMITES_DEMO_PAR_DEFAUT = {
  generale: { fenetreMs: 60_000, maximum: 600 },
  connexion: { fenetreMs: 60_000, maximum: 20 },
  televersement: { fenetreMs: 60_000, maximum: 8 },
};

// 10.4 : préfixes toujours autorisés en écriture même en mode dégradé —
// authentification (pour pouvoir se connecter et consulter), licence
// (pour revalider et sortir du mode dégradé) et sauvegarde ("export des
// données toujours possible", 10.3).
const PREFIXES_ECRITURE_TOUJOURS_AUTORISES = ["/api/v1/auth", "/api/v1/licence", "/api/v1/sauvegarde", "/api/v1/installation"];

// Seule exception « métier » : constater un paiement Mobile Money DÉJÀ initié. Le client a été débité avant la bascule en mode dégradé ;
// refuser d'enregistrer cet argent déjà encaissé le laissait sans trace, et la vente non payée. Ce n'est ni une vente ni une initiation
// de paiement (elles restent refusées) : on n'ajoute rien à ce qui s'est passé, on le constate.
const CONFIRMATION_PAIEMENT_MOBILE = /^\/api\/v1\/paiements-mobiles\/\d+\/actualiser$/;

// Politique de contenu de la page de l'interface : tout vient du poste lui-même. Les styles en ligne sont tolérés (attributs
// `style` de React, feuille d'impression) ; le QR s'affiche en data:, les logos et photos en blob:. Aucun script extérieur,
// aucun objet, aucun affichage de l'application dans le cadre d'un autre site.
const POLITIQUE_CONTENU =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

export function buildApp(db: Db, options: BuildAppOptions) {
  // nombre de proxys d'hébergeur dont on lit l'en-tête X-Forwarded-For (voir demo/adresse-visiteur.ts) ; la confiance de Fastify reste désactivée
  const sautsProxy = options.faireConfianceAuProxy === true ? 1 : typeof options.faireConfianceAuProxy === "number" && options.faireConfianceAuProxy > 0 ? Math.floor(options.faireConfianceAuProxy) : 0;
  const app = Fastify();

  // démo publique : le plafond de débit passe en premier (le moins coûteux), puis le refus des écritures sensibles
  const limites = options.limiteDebit ?? (options.modeDemo ? LIMITES_DEMO_PAR_DEFAUT : undefined);
  if (limites) {
    const limiteurGeneral = creerLimiteurDebit(limites.generale);
    const limiteurConnexion = creerLimiteurDebit(limites.connexion);
    const limiteurTeleversement = creerLimiteurDebit(limites.televersement);
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.startsWith("/api/")) return;
      const estConnexion = request.method === "POST" && request.url.split("?")[0] === "/api/v1/auth/login";
      // un envoi de fichier compte aussi dans le plafond général : il est limité deux fois, jamais une seule
      const adresse = adresseDuVisiteur(request.headers, request.ip, sautsProxy);
      const verdictGeneral = limiteurGeneral.verifier(adresse);
      const verdictSpecifique = estConnexion ? limiteurConnexion.verifier(adresse) : estTeleversement(request.method, request.url) ? limiteurTeleversement.verifier(adresse) : null;
      const verdict = !verdictGeneral.autorise ? verdictGeneral : (verdictSpecifique ?? verdictGeneral);
      if (verdict.autorise) return;
      reply.header("Retry-After", String(verdict.reessayerDansSecondes));
      reply.code(429).send({ erreur: `Trop de requêtes : réessayez dans ${verdict.reessayerDansSecondes} s.` });
      return reply;
    });
  }
  if (options.modeDemo) {
    app.addHook("onRequest", async (request, reply) => {
      if (!ecritureBloqueeEnDemo(request.method, request.url)) return;
      reply.code(403).send({ erreur: MESSAGE_FONCTION_DESACTIVEE_EN_DEMO });
      return reply;
    });
  }
  registerDemoRoutes(app, options.modeDemo === true);

  // en-têtes de sécurité de TOUTES les réponses (11.2) : pas d'affichage dans un cadre (clickjacking), pas d'adresse
  // transmise en Referer (le jeton de vérification est dans l'URL), pas de type de contenu deviné ; l'API ne se met
  // jamais en cache (données de clients) ; la politique de contenu accompagne les pages HTML.
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    // démo publique, servie en HTTPS par le proxy de l'hébergeur : le navigateur n'utilisera plus que HTTPS pour ce domaine. Jamais sur un
    // poste de caisse local (HTTP) : le protocole n'est lu que derrière un proxy déclaré, qui l'annonce.
    if (options.modeDemo && protocoleAnnonce(request.headers, sautsProxy) === "https") reply.header("Strict-Transport-Security", "max-age=31536000");
    if (String(reply.getHeader("Content-Type") ?? "").startsWith("text/html")) reply.header("Content-Security-Policy", POLITIQUE_CONTENU);
    return payload;
  });
  app.setErrorHandler(gestionnaireErreurFastify);
  app.setNotFoundHandler(options.dossierInterfaceWeb ? creerGestionnaireInterfaceWeb(options.dossierInterfaceWeb) : gestionnaireRouteInconnue);
  registerAuthPlugin(app, options.jwtSecret);
  const authRequis = creerAuthRequis(db);
  // 5.10 : téléversement des photos optionnelles du dossier SAV (multipart/form-data)
  app.register(multipart);
  registerAuthRoutes(app, db, authRequis, { sansVerrouillage: options.modeDemo === true });
  registerInstallationRoutes(app, db);
  const fournisseurPaiementMobile = options.fournisseurPaiementMobile ?? new SimulateurOrangeMoney();
  const fournisseurImpression = options.fournisseurImpression ?? new ImprimanteReseauTcp();

  // 10.3, 10.4 : un abonnement éditeur expiré ou une revalidation périodique
  // non réussie au-delà du délai de grâce hors ligne bascule l'application
  // en mode dégradé (lecture seule) — jamais de suppression de données,
  // jamais de blocage brutal des consultations.
  app.addHook("preHandler", async (request, reply) => {
    if (request.method === "GET" || request.method === "HEAD") return;
    const chemin = request.url.split("?")[0];
    if (PREFIXES_ECRITURE_TOUJOURS_AUTORISES.some((prefixe) => chemin.startsWith(prefixe)) || CONFIRMATION_PAIEMENT_MOBILE.test(chemin)) return;

    const licence = obtenirOuCreerLicence(db, new Date().toISOString());
    const statut = calculerEtatLicence(licence, new Date().toISOString());
    if (statut.etat === "DEGRADE") {
      reply.code(403).send({ erreur: messageModeDegrade(statut) });
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
  // 4.3 : résiliation manuelle d'un abonnement — « utilisateur habilité », donc l'encadrement
  const gestionResiliation = exigerRole("ADMINISTRATEUR", "GERANT");
  // reprise d'un abonné qui existait avant l'application : crée un abonnement actif sans rien encaisser, donc l'encadrement
  const gestionReprise = exigerRole("ADMINISTRATEUR", "GERANT");
  // 6.4 : émission d'un avoir — correction financière, réservée à l'encadrement
  const gestionAvoirs = exigerRole("ADMINISTRATEUR", "GERANT");
  // 13.1 : "validation par un rôle habilité" pour la fermeture de caisse — encadrement uniquement
  const validationCloture = exigerRole("ADMINISTRATEUR", "GERANT");
  // 8.8 : "Paramétrage (formules, tarifs, kits, options, taxes)" — le cahier
  // ne distingue pas taxes/mentions légales/logo du reste du paramétrage
  // catalogue, déjà ouvert au Gérant (gestionCatalogue)
  const gestionParametres = exigerRole("ADMINISTRATEUR", "GERANT");
  // 2.5.1 : "Comptable (lecture financière)" — consultation des fiches
  // clients et de leurs factures, sans droit de saisie/vente
  const lectureFinanciere = exigerRole("ADMINISTRATEUR", "GERANT", "CAISSIER", "COMPTABLE");
  // 6.5 : confirmation du rapprochement bancaire d'un virement — tâche
  // financière, mêmes rôles que le pilotage financier (8.6, 9.3)
  const gestionRapprochement = exigerRole("ADMINISTRATEUR", "GERANT", "COMPTABLE");
  // 8.1, 8.4 : recherche d'abonné — mêmes rôles que la lecture financière,
  // plus le Technicien SAV qui doit pouvoir rattacher un abonné existant à
  // un nouveau dossier (NouveauDossierDialog.tsx), sans accès à sa fiche
  // financière (fiche-360, factures) restée réservée à lectureFinanciere
  const rechercheAbonnes = exigerRole("ADMINISTRATEUR", "GERANT", "CAISSIER", "COMPTABLE", "TECHNICIEN_SAV");

  // 2.5.1 : « Apporteur d'affaires (lecture restreinte à ses propres abonnés
  // référés) » — produits, stock et catalogue sont des données internes,
  // jamais lisibles par ce partenaire externe
  const lectureInterne = exigerRole("ADMINISTRATEUR", "GERANT", "CAISSIER", "TECHNICIEN_SAV", "COMPTABLE");

  registerAbonnementsRoutes(app, db, { authRequis, ventes, gestionResiliation, gestionReprise });
  // 11.3 : anonymisation (droit de suppression) réservée à l'Administrateur seul
  registerAbonnesRoutes(app, db, { authRequis, ventes, fusionAbonnes, anonymisationAbonne: admin, lectureFinanciere, rechercheAbonnes });
  registerCatalogueRoutes(app, db, { authRequis, gestionCatalogue, lectureInterne });
  registerJobsRoutes(app, db, { authRequis, ventes, admin, lectureFinanciere });
  registerProduitsRoutes(app, db, { authRequis, ventes, gestionCatalogue, lectureInterne });
  registerSavRoutes(app, db, options.dossierPhotosSav ?? dossierPhotosSav(), { authRequis, ventes, sav });
  registerApporteursRoutes(app, db, { authRequis, ventes, gestionApporteurs, consultationApporteurs });
  registerStockRoutes(app, db, { authRequis, ventes, gestionStock, lectureInterne });
  registerPaiementMobileRoutes(app, db, fournisseurPaiementMobile, { authRequis, ventes });
  registerTableauBordRoutes(app, db, { authRequis, ventes, pilotage });
  registerExportComptableRoutes(app, db, { authRequis, pilotage });
  registerUtilisateursRoutes(app, db, { authRequis, admin });
  registerEntrepriseRoutes(app, db, options.dossierLogos ?? dossierLogos(), { authRequis, gestionParametres });
  registerComptesPartagesRoutes(app, db, { authRequis, ventes, gestionComptesPartages });
  // 5.2, 5.3, 8.5 : vente rapide de produits/services hors abonnement
  registerVentesRoutes(app, db, { authRequis, ventes });
  // 2.6 : sauvegardes et export manuel des données
  registerSauvegardeRoutes(app, db, options.dossierSauvegardes ?? dossierSauvegardes(), { authRequis, admin });
  // 6.4 : correction d'une facture VALIDEE par avoir
  registerAvoirRoutes(app, db, { authRequis, ventes, gestionAvoirs, lectureFinanciere, gestionRapprochement });
  // 10.4 : état de la licence éditeur, consultable par tout utilisateur connecté
  registerLicenceRoutes(app, db, { authRequis, admin });
  // 13.1 : clôture de caisse quotidienne (fond d'ouverture, comptage, écart théorique/réel)
  // la sauvegarde de fin de journée n'a lieu que si le dossier est fourni (le serveur le fait) : un test qui ne le donne pas n'écrit jamais dans les vraies données
  registerClotureCaisseRoutes(app, db, { authRequis, ventes, validationCloture }, { dossierSauvegardes: options.dossierSauvegardes });
  // 11.4, 6.7 : impression ESC/POS du ticket sur l'imprimante réseau du site, si configurée
  registerImpressionRoutes(app, db, fournisseurImpression, { authRequis, ventes });
  // 13.1 : fiche de vérification publique d'une facture (QR code) — sans authentification
  registerVerificationRoutes(app, db);

  return app;
}
