import { db } from "./db/client.js";
import { buildApp } from "./app.js";
import { obtenirSecretJwt } from "./config/jwt-secret.js";
import { planifierJobQuotidien } from "./jobs/planificateur.js";
import { planifierSauvegardeQuotidienne } from "./jobs/planificateur-sauvegarde.js";

const dossierSauvegardes = process.env.MBOAPILOT_BACKUPS_DIR ?? "./data/backups";
const app = buildApp(db, { jwtSecret: obtenirSecretJwt(), dossierSauvegardes });
const port = Number(process.env.PORT ?? 3001);

app
  .listen({ port, host: "127.0.0.1" }) // 2.2 : serveur applicatif embarqué en local, port 127.0.0.1
  .then(() => {
    console.log(`MboaPilot API en écoute sur http://127.0.0.1:${port}`);
    planifierJobQuotidien(db);
    planifierSauvegardeQuotidienne(db, dossierSauvegardes);
  })
  .catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  });
