import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 2.2 : où vivent les données de LA BOUTIQUE installée sur ce poste. Réservé à ses points d'entrée (server-boutique.ts, restauration, copie de
// sécurité, lanceur) : les tests et le développement ne lisent jamais donnees.txt, qui désigne les vraies données.
export const RACINE_APPLICATION = fileURLToPath(new URL("../../../..", import.meta.url));
const MARQUE = ".dernier-dossier-donnees";

export interface DossierBoutique {
  dossier: string;
  origine: "variable" | "donnees.txt" | "défaut";
}

// le fichier est écrit à la main, souvent avec le Bloc-notes : UTF-8 avec ou sans BOM, « Unicode » (UTF-16) ou ANSI
function decoder(contenu: Buffer): string {
  if (contenu[0] === 0xef && contenu[1] === 0xbb && contenu[2] === 0xbf) return contenu.subarray(3).toString("utf8");
  if (contenu[0] === 0xff && contenu[1] === 0xfe) return contenu.subarray(2).toString("utf16le");
  if (contenu[0] === 0xfe && contenu[1] === 0xff) return Buffer.from(contenu.subarray(2)).swap16().toString("utf16le");
  if (contenu.includes(0)) return contenu.toString("utf16le");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contenu);
  } catch {
    return new TextDecoder("windows-1252").decode(contenu);
  }
}

export function lireCheminDonneesTxt(contenu: Buffer): string {
  const premiere = decoder(contenu)
    .split(/\r\n|\r|\n/)
    .map((ligne) => ligne.trim())
    .find((ligne) => ligne !== "");
  if (!premiere) throw new Error("le fichier donnees.txt est vide : écrivez-y le dossier des données (par exemple C:\\MboaPilot-donnees), ou supprimez-le");
  const chemin = premiere
    .replace(/^(set\s+)?MBOAPILOT_DATA_DIR\s*=/i, "")
    .trim()
    .replace(/^["«\s]+|["»\s]+$/g, "");
  // après la lettre du lecteur, « : » est impossible ; les autres signes le sont partout
  if (!isAbsolute(chemin) || /[\u0000-\u001f\uFFFD<>|?*"]/.test(chemin)) {
    throw new Error(`le fichier donnees.txt doit contenir le chemin complet du dossier des données (par exemple C:\\MboaPilot-donnees) ; il contient « ${premiere} »`);
  }
  return resolve(chemin);
}

export function resoudreDossierBoutique({ racine = RACINE_APPLICATION, env = process.env }: { racine?: string; env?: Record<string, string | undefined> } = {}): DossierBoutique {
  const variable = env.MBOAPILOT_DATA_DIR?.trim();
  if (variable) return { dossier: resolve(variable), origine: "variable" };
  const fichier = join(racine, "donnees.txt");
  if (existsSync(fichier)) return { dossier: lireCheminDonneesTxt(readFileSync(fichier)), origine: "donnees.txt" };
  if (existsSync(`${fichier}.txt`)) {
    throw new Error(`le fichier s'appelle donnees.txt.txt : renommez-le en donnees.txt (dans l'Explorateur, affichez les extensions des fichiers) — ${fichier}.txt`);
  }
  return { dossier: join(racine, "apps", "api", "data"), origine: "défaut" };
}

const memeDossier = (a: string, b: string) => (process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
const contientUneBase = (dossier: string) => existsSync(join(dossier, "mboapilot.db"));

// Dernier filet contre la boutique vide : une faute de frappe dans donnees.txt, ou le fichier perdu, désigne un dossier sans base alors que la
// boutique est toujours à son ancien emplacement. Renvoie les avertissements à afficher ; lève une erreur quand il ne faut pas démarrer.
export function verifierDossierHabituel(racine: string, { dossier, origine }: DossierBoutique): string[] {
  const marque = join(racine, MARQUE);
  if (origine === "variable" || !existsSync(marque)) return [];
  const ancien = readFileSync(marque, "utf8").trim();
  if (!ancien || memeDossier(ancien, dossier) || !contientUneBase(ancien)) return [];
  // données déplacées vers un autre dossier désigné : normal. Retour au dossier par défaut (donnees.txt disparu) ou dossier vide : non.
  const vide = !contientUneBase(dossier);
  if (!vide && origine !== "défaut") return [`Attention : le dossier des données a changé depuis le dernier démarrage (avant : ${ancien}).`];
  throw new Error(
    `le dossier des données a changé. Au dernier démarrage, MboaPilot utilisait
  ${ancien}
qui contient toujours votre boutique. Il utiliserait maintenant
  ${dossier}
${vide ? "qui est vide" : "qui contient une autre base, sans doute ancienne"}.
` +
      `Vérifiez le fichier donnees.txt (à côté de lancer-mboapilot.bat).
Pour utiliser volontairement ${vide ? "une boutique vide" : "cet autre dossier"}, supprimez le fichier ${marque}.`,
  );
}

// seule une boutique réellement installée (au moins un compte) est mémorisée : jamais le dossier vide qu'on vient de créer par erreur
export function memoriserDossierHabituel(racine: string, { dossier, origine }: DossierBoutique, installee: boolean): void {
  if (origine === "variable" || !installee) return;
  const marque = join(racine, MARQUE);
  if (existsSync(marque) && readFileSync(marque, "utf8").trim() === dossier) return;
  writeFileSync(marque, `${dossier}\r\n`);
}
