import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { SUFFIXE_ANCIENNE_BASE, SUFFIXE_COPIE_EN_COURS } from "./restaurer-sauvegarde.service.js";

// 2.6 : ouverture de la base de la boutique, avec ses réglages.
export function ouvrirBase(chemin: string): Database.Database {
  // première installation : le dossier de données n'existe pas encore
  mkdirSync(dirname(chemin), { recursive: true });
  refuserRestaurationInterrompue(chemin);
  const sqlite = new Database(chemin);

  // non négociable — 2.4 : un seul écrivain, jamais de "database is locked"
  sqlite.pragma("journal_mode = WAL");
  // chaque écriture confirmée attend le disque. Le réglage par défaut du mode WAL (NORMAL) est plus rapide, mais une coupure de courant
  // pouvait effacer les dernières ventes, pourtant confirmées à l'écran et imprimées.
  sqlite.pragma("synchronous = FULL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

// Ouvrir un chemin sans fichier crée une base vide : après une restauration interrompue, le serveur proposait la première installation comme si
// la boutique n'avait jamais existé, et les ventes saisies ensuite partaient dans cette base neuve.
function refuserRestaurationInterrompue(chemin: string): void {
  if (existsSync(chemin)) return;
  const nom = basename(chemin);
  const restes = readdirSync(dirname(chemin)).filter((f) => f.startsWith(`${nom}${SUFFIXE_ANCIENNE_BASE}`) || f === `${nom}${SUFFIXE_COPIE_EN_COURS}`);
  if (restes.length === 0) return;

  const ancienne = `${chemin}${SUFFIXE_ANCIENNE_BASE}`;
  const retour = existsSync(ancienne) ? `\nPour revenir à la base d'avant :\n  npm run db:restaurer -- "${ancienne}"` : "";
  throw new Error(
    `une restauration semble avoir été interrompue : la base ${chemin} est absente, et ces fichiers sont à côté : ${restes.join(", ")}.\n` +
      `MboaPilot ne démarre pas, pour ne pas repartir d'une base vide.\n` +
      `Depuis le dossier apps/api, relancez la restauration :\n  npm run db:restaurer -- "<fichier de sauvegarde>"${retour}\n` +
      `Pour repartir volontairement d'une base vierge, déplacez d'abord ces fichiers ailleurs.`,
  );
}
