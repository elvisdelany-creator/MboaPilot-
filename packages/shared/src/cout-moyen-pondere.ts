// 5.2 : à chaque réception d'achat, le coût de revient du produit est
// recalculé en coût moyen pondéré (CUMP) plutôt que remplacé.
export function calculerCoutMoyenPondere(
  stockActuel: number,
  coutActuelRevient: number,
  quantiteAchetee: number,
  coutUnitaireAchat: number
): number {
  // un stock négatif (vente avant réception enregistrée) ne représente
  // aucune unité en main : ces unités sont déjà parties à l'ancien coût, elles
  // ne doivent pas peser négativement dans la moyenne
  const stockEnMain = Math.max(stockActuel, 0);
  const stockTotal = stockEnMain + quantiteAchetee;
  if (stockTotal === 0) return coutUnitaireAchat;
  return Math.round((stockEnMain * coutActuelRevient + quantiteAchetee * coutUnitaireAchat) / stockTotal);
}
