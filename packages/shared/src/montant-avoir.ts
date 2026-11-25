// 6.4 : ce qu'un avoir reprend sur une ligne de facture. Une ligne remisée ne se divise pas toujours (3 articles facturés 7 499 FCFA) :
// arrondir un prix unitaire puis le multiplier reprenait 7 500, un franc de plus que facturé, et le remboursait. Le montant se calcule donc
// sur le cumul : la part de la ligne correspondant à tout ce qui sera crédité, moins ce que les avoirs précédents ont déjà repris. Quelle
// que soit la découpe, créditer tous les articles reprend exactement le montant de la ligne.
export interface LigneCreditable {
  prixApplique: number; // montant net facturé de la ligne
  quantite: number; // quantité facturée
  quantiteDejaCreditee: number;
  montantDejaCredite: number; // montant positif déjà repris par les avoirs précédents
}

export function montantAvoirLigne(ligne: LigneCreditable, quantite: number): number {
  const cumul = Math.round((ligne.prixApplique * (ligne.quantiteDejaCreditee + quantite)) / ligne.quantite);
  return Math.max(0, cumul - ligne.montantDejaCredite);
}
