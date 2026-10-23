// 6.4, 9.2 : verrou synchrone contre les soumissions en double (double clic, Entrée répétée, deux déclencheurs en même temps).
// L'état d'interface « en cours » ne se met à jour qu'au prochain rendu : des déclenchements qui arrivent avant lui passent tous,
// et chacun encaisse (ou sort du stock) une fois de plus. Ici le verrou est pris dans la même tâche que le déclenchement.
// Un déclenchement qui arrive pendant l'exécution est ignoré (résultat `undefined`), jamais mis en file d'attente ; le verrou
// est libéré à la fin, y compris si l'action échoue, pour que le caissier puisse réessayer.
export function creerVerrouSoumission(): <T>(action: () => Promise<T>) => Promise<T | undefined> {
  let occupe = false;
  return async function executerUneFois<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (occupe) return undefined;
    occupe = true;
    try {
      return await action();
    } finally {
      occupe = false;
    }
  };
}
