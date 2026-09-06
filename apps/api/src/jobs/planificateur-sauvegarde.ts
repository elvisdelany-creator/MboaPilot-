import type { Db } from "../db/types.js";
import { creerSauvegarde, nettoyerAnciennesSauvegardes } from "../modules/sauvegarde/sauvegarde.service.js";

const JOURS_CONSERVATION_PAR_DEFAUT = 30;

// 2.6 : sauvegarde automatique quotidienne (a minima) avec conservation
// glissante sur 30 jours. Même patron que planifierJobQuotidien (pas de
// dépendance cron externe) mais un minuteur distinct : la sauvegarde est un
// souci d'infrastructure, indépendant du job métier des alertes/commissions.
export function planifierSauvegardeQuotidienne(
  db: Db,
  dossierSauvegardes: string,
  joursConservation = JOURS_CONSERVATION_PAR_DEFAUT,
  intervalleVerificationMs = 60 * 60 * 1000
): NodeJS.Timeout {
  let derniereExecution: string | null = null;

  function executerSiNecessaire() {
    const aujourdHui = new Date().toISOString().slice(0, 10);
    if (aujourdHui === derniereExecution) return;
    derniereExecution = aujourdHui;
    const sauvegarde = creerSauvegarde(db, dossierSauvegardes);
    const supprimees = nettoyerAnciennesSauvegardes(dossierSauvegardes, joursConservation);
    console.log(`Sauvegarde quotidienne (${aujourdHui}) : ${sauvegarde.nomFichier}, ${supprimees.length} ancienne(s) supprimée(s).`);
  }

  executerSiNecessaire();
  return setInterval(executerSiNecessaire, intervalleVerificationMs);
}
