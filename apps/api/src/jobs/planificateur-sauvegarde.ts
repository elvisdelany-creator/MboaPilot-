import type { Db } from "../db/types.js";
import { creerSauvegarde, listerSauvegardes, nettoyerAnciennesSauvegardes } from "../modules/sauvegarde/sauvegarde.service.js";

const JOURS_CONSERVATION_PAR_DEFAUT = 30;

function dejaSauvegardeAujourdhui(dossierSauvegardes: string, aujourdHui: string): boolean {
  return listerSauvegardes(dossierSauvegardes).some((s) => s.dateCreation.slice(0, 10) === aujourdHui);
}

// 2.6 : sauvegarde automatique quotidienne (a minima) avec conservation
// glissante sur 30 jours. Même patron que planifierJobQuotidien (pas de
// dépendance cron externe) mais un minuteur distinct : la sauvegarde est un
// souci d'infrastructure, indépendant du job métier des alertes/commissions.
// Le repère "déjà sauvegardé aujourd'hui" est relu depuis les fichiers déjà
// présents (jamais gardé seulement en mémoire) : un redémarrage du serveur —
// mise à jour, coupure de courant, plantage relancé par un gestionnaire de
// process — ne doit jamais recréer une sauvegarde déjà faite le jour même.
export function planifierSauvegardeQuotidienne(
  db: Db,
  dossierSauvegardes: string,
  joursConservation = JOURS_CONSERVATION_PAR_DEFAUT,
  intervalleVerificationMs = 60 * 60 * 1000
): NodeJS.Timeout {
  function executerSiNecessaire() {
    const aujourdHui = new Date().toISOString().slice(0, 10);
    if (dejaSauvegardeAujourdhui(dossierSauvegardes, aujourdHui)) return;
    const sauvegarde = creerSauvegarde(db, dossierSauvegardes);
    const supprimees = nettoyerAnciennesSauvegardes(dossierSauvegardes, joursConservation);
    console.log(`Sauvegarde quotidienne (${aujourdHui}) : ${sauvegarde.nomFichier}, ${supprimees.length} ancienne(s) supprimée(s).`);
  }

  executerSiNecessaire();
  return setInterval(executerSiNecessaire, intervalleVerificationMs);
}
