// 5.2 : à chaque réception d'achat, le coût de revient du produit est
// recalculé en coût moyen pondéré (CUMP) plutôt que remplacé.
export function calculerCoutMoyenPondere(
  stockActuel: number,
  coutActuelRevient: number,
  quantiteAchetee: number,
  coutUnitaireAchat: number
): number {
  const stockTotal = stockActuel + quantiteAchetee;
  if (stockTotal === 0) return coutUnitaireAchat;
  return Math.round((stockActuel * coutActuelRevient + quantiteAchetee * coutUnitaireAchat) / stockTotal);
}
