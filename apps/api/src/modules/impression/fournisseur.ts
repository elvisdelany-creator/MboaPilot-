// 11.4 : couche d'abstraction "fournisseur d'impression" — permet de
// brancher une imprimante thermique réseau réelle (ImprimanteReseauTcp) ou
// un double de test (SimulateurImpression), sans modifier le cœur
// applicatif (impression.service.ts).
export interface FournisseurImpression {
  imprimer(hote: string, port: number, donnees: Buffer): Promise<void>;
}
