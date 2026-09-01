import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Mode local (2.2) : aucune configuration externe requise pour démarrer. Si
// JWT_SECRET n'est pas fourni, un secret est généré une fois et persisté sur
// disque pour que les sessions survivent aux redémarrages. En mode hébergé
// (2.3) ou en marque blanche multi-tenant, définir JWT_SECRET explicitement.
export function obtenirSecretJwt(cheminSecret = "./data/.jwt-secret"): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  if (existsSync(cheminSecret)) return readFileSync(cheminSecret, "utf-8").trim();

  const secret = randomBytes(32).toString("hex");
  mkdirSync(dirname(cheminSecret), { recursive: true });
  writeFileSync(cheminSecret, secret, { mode: 0o600 });
  console.warn(
    "JWT_SECRET non défini — secret généré et persisté dans " +
      cheminSecret +
      ". Définir JWT_SECRET explicitement en mode hébergé (2.3)."
  );
  return secret;
}
