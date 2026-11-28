// Appelé par lancer-mboapilot.bat. Dit ce qu'une mise à jour oblige à refaire, en comparant le CONTENU des fichiers : leurs dates trompent (version
// plus ancienne recopiée, archive qui garde les dates d'origine, fichier supprimé). Sans aucune dépendance : s'exécute avant « npm install ».
//
//   node scripts/preparation.mjs verifier    -> 0 : rien ; 10 : réinstaller et reconstruire ; 11 : reconstruire l'interface
//   node scripts/preparation.mjs installe    -> note les composants installés
//   node scripts/preparation.mjs construit   -> note l'interface construite
//   node scripts/preparation.mjs en-service  -> note la version qui démarre
//   node scripts/preparation.mjs en-attente  -> 0 : la version en service est à jour ; 12 : une mise à jour attend un redémarrage
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// réinstaller exige Internet : seule la liste verrouillée des composants le justifie (tout ajout de composant la modifie)
const COMPOSANTS = ["package-lock.json"];
const INTERFACE = [
  ...COMPOSANTS,
  "package.json",
  "apps/api/package.json",
  "packages/shared/package.json",
  "apps/web/package.json",
  "apps/web/src",
  "apps/web/public",
  "apps/web/index.html",
  "apps/web/vite.config.ts",
  "apps/web/tsconfig.json",
  "apps/web/tsconfig.app.json",
  "apps/web/components.json",
  "packages/shared/src",
];
const APPLICATION = [...INTERFACE, "apps/api/src"];

const EMPREINTE_COMPOSANTS = "node_modules/.empreinte-composants";
const EMPREINTE_INTERFACE = "apps/web/dist/.empreinte-interface";
const VERSION_EN_SERVICE = ".version-en-service";

function fichiers(racine, chemin) {
  const complet = join(racine, chemin);
  if (!existsSync(complet)) return [];
  if (!statSync(complet).isDirectory()) return [chemin];
  return readdirSync(complet).flatMap((nom) => (nom === "node_modules" || nom === "dist" ? [] : fichiers(racine, `${chemin}/${nom}`)));
}

function empreinte(racine, chemins) {
  const somme = createHash("sha256");
  for (const f of chemins.flatMap((c) => fichiers(racine, c)).sort()) {
    // fins de ligne ignorées : une copie par un autre outil ne doit pas passer pour une mise à jour (« latin1 » garde les fichiers binaires intacts)
    const contenu = readFileSync(join(racine, f), "latin1").replace(/\r\n/g, "\n");
    somme.update(`${f}\0`).update(contenu, "latin1").update("\0");
  }
  return somme.digest("hex");
}

const lue = (racine, fichier) => (existsSync(join(racine, fichier)) ? readFileSync(join(racine, fichier), "utf8").trim() : null);
const noter = (racine, fichier, valeur) => writeFileSync(join(racine, fichier), `${valeur}\n`);

function aReinstaller(racine) {
  if (!existsSync(join(racine, "node_modules"))) return true;
  const notee = lue(racine, EMPREINTE_COMPOSANTS);
  if (notee !== null) return notee !== empreinte(racine, COMPOSANTS);
  // premier lancement avec ce script : n'exiger une connexion Internet que si les dates montrent un changement, puis retenir l'empreinte
  const liste = join(racine, "package-lock.json");
  const installee = join(racine, "node_modules/.package-lock.json");
  if (existsSync(liste) && existsSync(installee) && statSync(liste).mtimeMs > statSync(installee).mtimeMs) return true;
  noter(racine, EMPREINTE_COMPOSANTS, empreinte(racine, COMPOSANTS));
  return false;
}

export function executer(commande, racine) {
  switch (commande) {
    case "verifier":
      if (aReinstaller(racine)) return 10;
      return existsSync(join(racine, "apps/web/dist/index.html")) && lue(racine, EMPREINTE_INTERFACE) === empreinte(racine, INTERFACE) ? 0 : 11;
    case "installe":
      noter(racine, EMPREINTE_COMPOSANTS, empreinte(racine, COMPOSANTS));
      return 0;
    case "construit":
      noter(racine, EMPREINTE_INTERFACE, empreinte(racine, INTERFACE));
      return 0;
    case "en-service":
      noter(racine, VERSION_EN_SERVICE, empreinte(racine, APPLICATION));
      return 0;
    case "en-attente":
      return lue(racine, VERSION_EN_SERVICE) === empreinte(racine, APPLICATION) ? 0 : 12;
    default:
      throw new Error(`Commande inconnue : ${commande}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = executer(process.argv[2], fileURLToPath(new URL("..", import.meta.url)));
  } catch (erreur) {
    console.error(erreur.message);
    process.exitCode = 1;
  }
}
