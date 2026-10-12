import type { Db } from "../db/types.js";
import { executerJobQuotidien, type JobQuotidienResultat } from "../modules/jobs/job-quotidien.service.js";

// 4.3, 4.4, 6.2 : exécute le job quotidien au démarrage (rattrapage si le
// serveur était éteint au changement de date) puis vérifie périodiquement
// si la date a changé. Pas de dépendance cron externe : le serveur local
// (2.2) tourne en continu, une simple vérification horaire suffit.
//
// Robustesse : une tâche planifiée ne doit jamais arrêter le serveur de caisse. Une
// exception est journalisée et le job est retenté à la vérification suivante — le jour
// n'est marqué « fait » qu'après une exécution réussie.
export function planifierJobQuotidien(
  db: Db,
  intervalleVerificationMs = 60 * 60 * 1000,
  executer: (db: Db, aujourdHui: string) => JobQuotidienResultat = executerJobQuotidien
): NodeJS.Timeout {
  let derniereExecution: string | null = null;

  function executerSiNecessaire() {
    const aujourdHui = new Date().toISOString().slice(0, 10);
    if (aujourdHui === derniereExecution) return;
    try {
      const resultat = executer(db, aujourdHui);
      derniereExecution = aujourdHui;
      console.log(`Job quotidien (${aujourdHui}) :`, resultat);
    } catch (erreur) {
      console.error(`Job quotidien (${aujourdHui}) en échec — nouvelle tentative à la prochaine vérification :`, erreur);
    }
  }

  executerSiNecessaire();
  return setInterval(executerSiNecessaire, intervalleVerificationMs);
}
