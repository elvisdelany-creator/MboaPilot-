import { db } from "./db/client.js";
import { appliquerMigrations } from "./db/appliquer-migrations.js";
import { checkpointerBase, installerArretPropre, planifierCheckpoint } from "./db/arret-propre.js";
import { buildApp } from "./app.js";
import { obtenirSecretJwt } from "./config/jwt-secret.js";
import { obtenirCleChiffrement } from "./config/encryption-key.js";
import { planifierJobQuotidien } from "./jobs/planificateur.js";
import { planifierSauvegardeQuotidienne } from "./jobs/planificateur-sauvegarde.js";
import { revaliderLicence } from "./modules/licence/licence.service.js";
import { dossierSauvegardes as dossierSauvegardesConfigure } from "./config/chemins.js";
import { resoudreDossierInterfaceWeb } from "./lib/interface-web.js";
import { estModeDemo } from "./demo/mode-demo.js";

// 2.6 : base restaurée ou application mise à jour — mise à niveau avant toute requête
appliquerMigrations(db);
// mboapilot.db doit être complet à lui seul dès le démarrage (une fermeture brutale précédente a pu laisser des écritures
// dans le journal -wal), puis régulièrement, et à l'arrêt propre : voir db/arret-propre.ts
checkpointerBase(db);

// clé de chiffrement contrôlée dès le démarrage : un fichier illisible doit se voir tout de suite, pas à la première saisie d'un compte partagé
try {
  obtenirCleChiffrement();
} catch (erreur) {
  console.error(`[MboaPilot] Démarrage impossible : ${(erreur as Error).message}`);
  process.exit(1);
}

const dossierSauvegardes = dossierSauvegardesConfigure();
const dossierInterfaceWeb = resoudreDossierInterfaceWeb();
// démo publique (voir demo/mode-demo.ts) ; MBOAPILOT_PROXY=N : derrière N proxys d'hébergeur (1 en général), dont on lit l'adresse du visiteur
const sautsProxy = Number(process.env.MBOAPILOT_PROXY ?? 0);
const app = buildApp(db, { jwtSecret: obtenirSecretJwt(), dossierSauvegardes, dossierInterfaceWeb, modeDemo: estModeDemo(), faireConfianceAuProxy: Number.isFinite(sautsProxy) ? sautsProxy : 0 });
const port = Number(process.env.PORT ?? 3001);
// 2.2 : le poste de caisse n'écoute que sur lui-même. Seul un hébergement (démo publique) fixe MBOAPILOT_HOTE=0.0.0.0 pour recevoir le proxy de
// l'hébergeur. Variable propre à MboaPilot, pas « HOST » : un nom aussi courant pourrait exister par hasard sur un poste de caisse et l'exposer au réseau.
const hote = process.env.MBOAPILOT_HOTE ?? "127.0.0.1";

app
  .listen({ port, host: hote })
  .then(() => {
    console.log(`MboaPilot API en écoute sur http://${hote}:${port}`);
    console.log(dossierInterfaceWeb ? `Interface web servie depuis ${dossierInterfaceWeb} : ouvrez http://${hote === "0.0.0.0" ? "127.0.0.1" : hote}:${port}` : "Interface web non construite (apps/web/dist absent) : lancez `npm run build` dans apps/web, ou le serveur de développement.");
    // 10.4 étape 2 : tentative de revalidation "au démarrage" — simulée en
    // l'absence de serveur de licence éditeur réel, réussit systématiquement
    // et repousse d'autant le délai de grâce hors ligne (21 j).
    revaliderLicence(db, new Date().toISOString());
    planifierJobQuotidien(db);
    planifierSauvegardeQuotidienne(db, dossierSauvegardes);
    planifierCheckpoint(db);
    installerArretPropre(app, db);
  })
  .catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  });
