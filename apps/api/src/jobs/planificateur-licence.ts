import type { Db } from "../db/types.js";
import { obtenirOuCreerLicence, revaliderLicence } from "../modules/licence/licence.service.js";

// 10.4 étape 2 : « revalidation périodique (ex. au démarrage, une fois par jour) ». La date est relue toutes les minutes : un poste laissé allumé
// plusieurs semaines, ou sorti de veille, est revalidé sans redémarrage, au lieu de passer en lecture seule au 22e jour. Une seule écriture par
// jour. Un échec est journalisé et retenté, sans jamais arrêter le serveur de caisse. Quand un vrai serveur de licence existera, c'est ici qu'il
// sera appelé.
export function planifierRevalidationLicence(
  db: Db,
  intervalleVerificationMs = 60 * 1000,
  revalider: typeof revaliderLicence = revaliderLicence,
): NodeJS.Timeout {
  let auDemarrage = true;

  function revaliderSiNecessaire() {
    try {
      const maintenant = new Date().toISOString();
      const derniere = obtenirOuCreerLicence(db, maintenant).derniereRevalidationReussie;
      // au démarrage, toujours ; ensuite quand le jour a changé (y compris après une correction de l'horloge)
      if (!auDemarrage && derniere.slice(0, 10) === maintenant.slice(0, 10)) return;
      revalider(db, maintenant);
      auDemarrage = false;
    } catch (erreur) {
      console.error("[MboaPilot] Revalidation de la licence en échec, nouvelle tentative dans un instant :", erreur);
    }
  }

  revaliderSiNecessaire();
  return setInterval(revaliderSiNecessaire, intervalleVerificationMs);
}
