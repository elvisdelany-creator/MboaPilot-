import { db } from "./db/client.js";
import { buildApp } from "./app.js";
import { obtenirSecretJwt } from "./config/jwt-secret.js";

const app = buildApp(db, { jwtSecret: obtenirSecretJwt() });
const port = Number(process.env.PORT ?? 3001);

app
  .listen({ port, host: "127.0.0.1" }) // 2.2 : serveur applicatif embarqué en local, port 127.0.0.1
  .then(() => console.log(`MboaPilot API en écoute sur http://127.0.0.1:${port}`))
  .catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  });
