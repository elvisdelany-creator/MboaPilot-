// 6.4, 2.5.1 : un caissier ne remise pas au-delà d'un pourcentage du prix de la ligne (20 % par défaut, réglable). Une remise est un
// montant entier de FCFA : le plafond s'arrondit vers le bas, de sorte qu'aucune remise acceptée ne dépasse le pourcentage. Partagé
// entre le serveur (qui refuse) et la caisse (qui montre la limite avant la validation, au lieu de la révéler par un refus).
export function plafondRemiseCaissier(prixBase: number, pourcent: number): number {
  const plafond = Math.floor((prixBase * pourcent) / 100);
  return Math.max(0, Math.min(plafond, prixBase));
}
