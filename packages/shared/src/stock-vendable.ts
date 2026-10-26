// 5.2 : un stock ne descend jamais sous zéro (le serveur refuse toute sortie au-delà du disponible). La caisse applique la même règle
// avant même l'envoi : elle n'offre pas de mettre au panier plus que le stock. Un article dont le stock n'est pas suivi (service)
// n'a pas de limite.
export function peutAjouterAuPanier(produit: { suiviStock: number; quantiteStock: number }, quantiteDejaAuPanier: number): boolean {
  return produit.suiviStock !== 1 || quantiteDejaAuPanier < produit.quantiteStock;
}

export function messageStockInsuffisant(libelle: string, disponible: number): string {
  return disponible > 0 ? `Stock insuffisant pour « ${libelle} » : ${disponible} disponible(s).` : `« ${libelle} » est en rupture de stock.`;
}
