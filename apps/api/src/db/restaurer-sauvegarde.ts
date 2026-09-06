// 2.6 : procédure de restauration — "ne doit jamais nécessiter d'intervention
// développeur". Commande unique, documentée par ce message d'usage, exécutable
// par un Administrateur depuis un terminal (au même titre que db:migrate/
// db:seed:dev déjà présents dans package.json) : `npm run db:restaurer -- <chemin-sauvegarde>`.
//
// ⚠️ Le serveur MboaPilot doit être arrêté avant restauration : une bascule à
// chaud du fichier SQLite sous une connexion ouverte (mode WAL) risquerait de
// désynchroniser le processus en cours avec les fichiers -wal/-shm.
import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const DB_PATH = process.env.MBOAPILOT_DB_PATH ?? "./data/mboapilot.db";
const cheminSauvegarde = process.argv[2];

if (!cheminSauvegarde) {
  console.error("Usage : npm run db:restaurer -- <chemin-vers-la-sauvegarde.db>");
  process.exit(1);
}

if (!existsSync(cheminSauvegarde)) {
  console.error(`Fichier de sauvegarde introuvable : ${cheminSauvegarde}`);
  process.exit(1);
}

// vérifie que le fichier est une base SQLite exploitable avant d'écraser quoi que ce soit
const verification = new Database(cheminSauvegarde, { readonly: true });
const resultatVerification = verification.pragma("integrity_check(1)", { simple: false }) as { integrity_check: string }[];
const { integrity_check: integrity } = resultatVerification[0];
verification.close();
if (integrity !== "ok") {
  console.error(`Sauvegarde corrompue (integrity_check: ${integrity}) — restauration annulée.`);
  process.exit(1);
}

mkdirSync(dirname(DB_PATH), { recursive: true });

// écarte l'ancienne base plutôt que de la supprimer directement (filet de
// sécurité manuel si la restauration devait être annulée dans la foulée)
if (existsSync(DB_PATH)) {
  renameSync(DB_PATH, `${DB_PATH}.avant-restauration`);
}
for (const suffixe of ["-wal", "-shm"]) {
  if (existsSync(`${DB_PATH}${suffixe}`)) renameSync(`${DB_PATH}${suffixe}`, `${DB_PATH}${suffixe}.avant-restauration`);
}

copyFileSync(cheminSauvegarde, DB_PATH);

console.log(`Base restaurée depuis ${cheminSauvegarde} vers ${DB_PATH}.`);
console.log(`L'ancienne base (le cas échéant) a été conservée sous ${DB_PATH}.avant-restauration.`);
console.log("Redémarrez le serveur MboaPilot pour appliquer la restauration.");
