import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cheminCleChiffrement } from "./chemins.js";

// 11.2 : chiffrement des données sensibles au repos (identifiants de comptes
// streaming partagés, mots de passe, 5.9) — même stratégie mode local (2.2)
// que le secret JWT (jwt-secret.ts) : aucune configuration externe requise
// pour démarrer, clé générée une fois et persistée sur disque si absente.
const FORME_CLE = /^[0-9a-fA-F]{64}$/;

// Une clé tronquée ou illisible faisait échouer le chiffrement plus tard, à la première saisie d'un compte
// partagé (« Erreur interne »). Elle est contrôlée ici, sans jamais être régénérée en silence : le fichier est
// peut-être en cours de réparation depuis une copie, et une nouvelle clé rendrait les identifiants illisibles.
function lireCle(valeur: string, origine: string): Buffer {
  const propre = valeur.trim();
  if (!FORME_CLE.test(propre)) {
    throw new Error(
      `Clé de chiffrement invalide (${origine}) : 64 caractères hexadécimaux attendus. ` +
        "Remettez la copie d'origine de la clé, ou supprimez le fichier pour en générer une nouvelle " +
        "(les identifiants des comptes streaming partagés devront alors être ressaisis)."
    );
  }
  return Buffer.from(propre, "hex");
}

export function obtenirCleChiffrement(cheminCle = cheminCleChiffrement()): Buffer {
  if (process.env.MBOAPILOT_ENCRYPTION_KEY) return lireCle(process.env.MBOAPILOT_ENCRYPTION_KEY, "variable MBOAPILOT_ENCRYPTION_KEY");

  if (existsSync(cheminCle)) return lireCle(readFileSync(cheminCle, "utf-8"), cheminCle);

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
