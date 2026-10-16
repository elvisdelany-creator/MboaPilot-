// 2.6 : procédure de restauration — "ne doit jamais nécessiter d'intervention
// développeur". Commande unique, documentée par ce message d'usage, exécutable
// par un Administrateur depuis un terminal (au même titre que db:migrate/
// db:seed:dev déjà présents dans package.json) : `npm run db:restaurer -- <chemin-sauvegarde>`.
//
// ⚠️ Le serveur MboaPilot doit être arrêté avant restauration : une bascule à
// chaud du fichier SQLite sous une connexion ouverte (mode WAL) risquerait de
// désynchroniser le processus en cours avec les fichiers -wal/-shm.
import { cheminBase } from "../config/chemins.js";
import { restaurerSauvegarde } from "./restaurer-sauvegarde.service.js";

const DB_PATH = cheminBase();
const cheminSauvegarde = process.argv[2];

if (!cheminSauvegarde) {
  console.error("Usage : npm run db:restaurer -- <chemin-vers-la-sauvegarde.db>");
  process.exit(1);
}

try {
  restaurerSauvegarde(cheminSauvegarde, DB_PATH);
} catch (erreur) {
  console.error((erreur as Error).message);
  process.exit(1);
}

console.log(`Base restaurée depuis ${cheminSauvegarde} vers ${DB_PATH}.`);
console.log(`L'ancienne base (le cas échéant) a été conservée sous ${DB_PATH}.avant-restauration.`);
console.log("Redémarrez le serveur MboaPilot pour appliquer la restauration.");
