import type { Db } from "../db/types.js";
import { executerJobQuotidien } from "../modules/jobs/job-quotidien.service.js";

// 4.3, 4.4, 6.2 : exécute le job quotidien au démarrage (rattrapage si le
// serveur était éteint au changement de date) puis vérifie périodiquement
// si la date a changé. Pas de dépendance cron externe : le serveur local
// (2.2) tourne en continu, une simple vérification horaire suffit.
export function planifierJobQuotidien(db: Db, intervalleVerificationMs = 60 * 60 * 1000): NodeJS.Timeout {
  let derniereExecution: string | null = null;

  function executerSiNecessaire() {
    const aujourdHui = new Date().toISOString().slice(0, 10);
    if (aujourdHui === derniereExecution) return;
    derniereExecution = aujourdHui;
    const resultat = executerJobQuotidien(db, aujourdHui);
    console.log(`Job quotidien (${aujourdHui}) :`, resultat);
  }

  executerSiNecessaire();
  return setInterval(executerSiNecessaire, intervalleVerificationMs);
}
