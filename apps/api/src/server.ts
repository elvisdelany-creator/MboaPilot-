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
const app = buildApp(db, { jwtSecret: obtenirSecretJwt(), dossierSauvegardes, dossierInterfaceWeb });
const port = Number(process.env.PORT ?? 3001);

app
  .listen({ port, host: "127.0.0.1" }) // 2.2 : serveur applicatif embarqué en local, port 127.0.0.1
  .then(() => {
    console.log(`MboaPilot API en écoute sur http://127.0.0.1:${port}`);
    console.log(dossierInterfaceWeb ? `Interface web servie depuis ${dossierInterfaceWeb} : ouvrez http://127.0.0.1:${port}` : "Interface web non construite (apps/web/dist absent) : lancez `npm run build` dans apps/web, ou le serveur de développement.");
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
