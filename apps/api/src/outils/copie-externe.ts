// 2.6 : copie de sécurité HORS de l'ordinateur (clé USB, second disque, dossier réseau), lancée par sauvegarde-externe.bat. Copie les
// sauvegardes, la clé de chiffrement, les photos SAV et le logo ; jamais la base en service, qui peut être vide ou périmée tant que MboaPilot
// tourne.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { listerSauvegardes } from "../modules/sauvegarde/sauvegarde.service.js";

export interface CopieParams {
  donnees: string;
  sauvegardes: string; // dossier des sauvegardes (MBOAPILOT_BACKUPS_DIR peut le placer ailleurs)
  destination: string;
  maintenant?: Date;
}

export interface ResultatCopie {
  code: 0 | 1 | 2; // 0 : copie à jour ; 1 : échec ; 2 : copié, mais pas de quoi se rassurer
  messages: string[];
}

const AGE_MAX_SAUVEGARDE_MS = 48 * 3600 * 1000;
// la base en service, le secret de session et les fichiers incomplets
const FICHIERS_EXCLUS = ["mboapilot.db", "mboapilot.db-wal", "mboapilot.db-shm", ".jwt-secret", "mboapilot.db.restauration-en-cours", "*.partiel", "*.partiel-journal"];

const estDans = (chemin: string, dossier: string) => {
  const trajet = relative(dossier, chemin);
  return trajet === "" || (!trajet.startsWith("..") && !isAbsolute(trajet));
};

// robocopy ne recopie que ce qui a changé. Deux nouvelles tentatives seulement : par défaut il insiste pendant des jours sur un support retiré.
function robocopier(source: string, destination: string, filtres: string[]): boolean {
  const r = spawnSync("robocopy", [source, destination, ...filtres, "/R:2", "/W:2", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], { stdio: "ignore" });
  // 0 à 7 : succès ; 8 et plus : échec
  return r.status !== null && r.status < 8;
}

export function copierVersExterne({ donnees, sauvegardes, destination, maintenant = new Date() }: CopieParams): ResultatCopie {
  const source = resolve(donnees);
  const dossierSauvegardes = resolve(sauvegardes);
  const cible = resolve(destination);
  const echec = (message: string): ResultatCopie => ({ code: 1, messages: [message] });

  if (!existsSync(source)) return echec(`Dossier de données introuvable : ${source}`);
  if (estDans(cible, source) || estDans(cible, dossierSauvegardes)) {
    return echec("La destination est dans le dossier des données : la copie disparaîtrait avec lui. Choisissez un support hors de l'ordinateur (clé USB, second disque).");
  }

  const ECHEC = "ECHEC de la copie : vérifiez que la destination est branchée et qu'il reste de la place.";
  const ailleurs = dossierSauvegardes.toLowerCase() !== join(source, "backups").toLowerCase();
  const exclusions = ["/XF", ...FICHIERS_EXCLUS, ...(ailleurs ? ["/XD", join(source, "backups")] : [])];
  if (!robocopier(source, cible, ["/E", ...exclusions])) return echec(ECHEC);
  if (ailleurs && existsSync(dossierSauvegardes) && !robocopier(dossierSauvegardes, join(cible, "backups"), ["mboapilot-sauvegarde-*.db"])) return echec(ECHEC);

  const EXPORTER = "Dans MboaPilot, faites Administration → Paramètres → « Exporter mes données » (ou clôturez la caisse), puis relancez cette copie.";
  const derniere = listerSauvegardes(dossierSauvegardes)[0];
  if (!derniere || !existsSync(join(cible, "backups", derniere.nomFichier))) {
    return { code: 2, messages: [`ATTENTION : aucune sauvegarde de la boutique sur ce support (cherchées dans ${dossierSauvegardes}).`, EXPORTER] };
  }
  const date = new Date(derniere.dateCreation);
  const age = maintenant.getTime() - date.getTime();
  const jour = date.toLocaleDateString("fr-FR", { timeZone: "Africa/Douala" });
  if (age > AGE_MAX_SAUVEGARDE_MS) {
    return { code: 2, messages: [`ATTENTION : la sauvegarde la plus récente date du ${jour}, il y a ${Math.floor(age / 86_400_000)} jours. Tout ce qui a été saisi depuis n'est pas sur ce support.`, EXPORTER] };
  }
  const heure = date.toLocaleTimeString("fr-FR", { timeZone: "Africa/Douala", hour: "2-digit", minute: "2-digit" });
  return { code: 0, messages: [`Copie terminée : "${cible}"`, `Dernière sauvegarde copiée : ${jour} à ${heure}.`, "Gardez ce support en lieu sûr, hors de l'ordinateur de la boutique."] };
}

// lancé en ligne de commande (et non importé par les tests) : seul ce cas lit donnees.txt
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { dossierBoutique } = await import("../config/appliquer-donnees-txt.js");
  const { RACINE_APPLICATION } = await import("../config/dossier-boutique.js");
  const { dossierSauvegardes } = await import("../config/chemins.js");
  // par une variable d'environnement : en argument, « E:\ » serait mal lu
  const demandee = (process.env.MBOAPILOT_DESTINATION ?? process.argv[2] ?? "").trim().replace(/^"+|"+$/g, "");
  if (!demandee) {
    console.error("Aucune destination indiquée : rien n'a été copié.");
    process.exit(1);
  }
  const destination = resolve(RACINE_APPLICATION, demandee);
  console.log(`Copie de "${dossierBoutique.dossier}" vers "${destination}" ...`);
  const resultat = copierVersExterne({ donnees: dossierBoutique.dossier, sauvegardes: dossierSauvegardes(), destination });
  for (const message of resultat.messages) console.log(message);
  process.exitCode = resultat.code;
}
