import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 2.2, 2.6 : emplacement de TOUTES les données (base, secret JWT, clé de chiffrement,
// sauvegardes, photos SAV, logos). Il ne dépend jamais du dossier depuis lequel le
// serveur est lancé : un chemin relatif (« ./data ») faisait planter le démarrage
// depuis un autre dossier, ou repartir en silence sur une base neuve, avec un autre
// secret et une autre clé de chiffrement.
//
// Par défaut : le dossier « data » de l'API (apps/api/data). MBOAPILOT_DATA_DIR le
// déplace entièrement ; les variables historiques restent prioritaires.
type Environnement = Record<string, string | undefined>;

const DOSSIER_API = fileURLToPath(new URL("../..", import.meta.url));

export function dossierDonnees(env: Environnement = process.env): string {
  return env.MBOAPILOT_DATA_DIR ? resolve(env.MBOAPILOT_DATA_DIR) : join(DOSSIER_API, "data");
}

export const cheminBase = (env: Environnement = process.env) => env.MBOAPILOT_DB_PATH ?? join(dossierDonnees(env), "mboapilot.db");
export const dossierSauvegardes = (env: Environnement = process.env) => env.MBOAPILOT_BACKUPS_DIR ?? join(dossierDonnees(env), "backups");
export const dossierPhotosSav = (env: Environnement = process.env) => join(dossierDonnees(env), "sav-photos");
export const dossierLogos = (env: Environnement = process.env) => join(dossierDonnees(env), "logos");
export const cheminSecretJwt = (env: Environnement = process.env) => join(dossierDonnees(env), ".jwt-secret");
export const cheminCleChiffrement = (env: Environnement = process.env) => join(dossierDonnees(env), ".encryption-key");
