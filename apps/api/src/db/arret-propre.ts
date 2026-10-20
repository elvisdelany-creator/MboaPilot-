import type { Db } from "./types.js";

// En mode WAL, les écritures récentes vivent dans le fichier mboapilot.db-wal tant qu'un « point de contrôle » ne les a pas
// fusionnées dans mboapilot.db. Constaté : un .db de 4 Ko et zéro vente pour un -wal de 830 Ko. Une boutique qui copie le seul
// fichier mboapilot.db sur une clé USB, ou qui ferme brutalement la fenêtre du lanceur, risquait donc de n'emporter qu'une
// base vide ou périmée. Les sauvegardes automatiques et « Exporter mes données » ne sont pas concernées (VACUUM INTO).

// fusionne tout le journal dans le fichier .db et le remet à zéro
export function checkpointerBase(db: Db): void {
  db.$client.pragma("wal_checkpoint(TRUNCATE)");
}

const INTERVALLE_CHECKPOINT_PAR_DEFAUT_MS = 5 * 60 * 1000;

// Point de contrôle régulier : le .db ne retarde ainsi que de quelques minutes sur les ventes. Jamais d'exception : un
// passage manqué est journalisé et ne doit pas arrêter la caisse (le serveur est mono-processus et ses requêtes sont
// synchrones : ce passage s'exécute entre deux requêtes, jamais au milieu d'une écriture).
export function planifierCheckpoint(db: Db, intervalleMs = INTERVALLE_CHECKPOINT_PAR_DEFAUT_MS): NodeJS.Timeout {
  const minuteur = setInterval(() => {
    try {
      checkpointerBase(db);
    } catch (erreur) {
      console.error("Point de contrôle de la base en échec — nouvelle tentative au prochain passage :", erreur);
    }
  }, intervalleMs);
  minuteur.unref(); // ne retient jamais l'arrêt du processus
  return minuteur;
}

interface Serveur {
  close: () => Promise<unknown>;
}
type Processus = Pick<NodeJS.Process, "on" | "exit">;

// Arrêt propre : sur Ctrl+C, sur la demande d'arrêt de Windows ou à la fermeture de la fenêtre de la console (SIGHUP, avec
// une dizaine de secondes avant l'arrêt forcé), le serveur cesse d'accepter des requêtes, le journal est fusionné et la
// base fermée : mboapilot.db est alors complet à lui seul. Un seul arrêt à la fois ; il quitte même si l'arrêt du serveur échoue.
export function installerArretPropre(app: Serveur, db: Db, processus: Processus = process): void {
  let enCours = false;

  async function arreter(signal: string) {
    if (enCours) return;
    enCours = true;
    console.log(`Arrêt de MboaPilot demandé (${signal}) : fermeture propre de la base…`);
    let code = 0;
    try {
      await app.close();
      checkpointerBase(db);
      db.$client.close();
    } catch (erreur) {
      console.error("Arrêt propre en échec :", erreur);
      code = 1;
    }
    processus.exit(code);
  }

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
    processus.on(signal, () => void arreter(signal));
  }
}
