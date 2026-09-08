import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// 11.2 : chiffrement des données sensibles au repos (identifiants de comptes
// streaming partagés, mots de passe, 5.9) — même stratégie mode local (2.2)
// que le secret JWT (jwt-secret.ts) : aucune configuration externe requise
// pour démarrer, clé générée une fois et persistée sur disque si absente.
export function obtenirCleChiffrement(cheminCle = "./data/.encryption-key"): Buffer {
  if (process.env.MBOAPILOT_ENCRYPTION_KEY) return Buffer.from(process.env.MBOAPILOT_ENCRYPTION_KEY, "hex");

  if (existsSync(cheminCle)) return Buffer.from(readFileSync(cheminCle, "utf-8").trim(), "hex");

  const cle = randomBytes(32);
  mkdirSync(dirname(cheminCle), { recursive: true });
  writeFileSync(cheminCle, cle.toString("hex"), { mode: 0o600 });
  console.warn(
    "MBOAPILOT_ENCRYPTION_KEY non défini — clé générée et persistée dans " +
      cheminCle +
      ". Définir MBOAPILOT_ENCRYPTION_KEY explicitement en mode hébergé (2.3)."
  );
  return cle;
}
