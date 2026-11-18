// Rend la main à la boucle d'événements de Node : les autres requêtes en attente (un caissier qui encaisse) sont traitées avant que le calcul ne reprenne.
// Node n'exécute qu'une chose à la fois : un calcul long, d'un seul bloc, fait attendre tout le monde. Découpé en morceaux séparés par cette pause, il ne
// retarde plus personne que de la durée d'un morceau.
export function cederLaMain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
