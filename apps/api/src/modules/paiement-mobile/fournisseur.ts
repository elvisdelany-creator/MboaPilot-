export type ParcoursPaiementMobile = "USSD_CLIENT" | "PUSH_MARCHAND";
export type StatutFournisseur = "EN_ATTENTE" | "REUSSIE" | "ECHOUEE" | "EXPIREE";

export interface InitierParams {
  numeroTelephone: string;
  montant: number;
  parcours: ParcoursPaiementMobile;
}

// 6.6 : couche d'abstraction "fournisseur de paiement mobile" — permet de
// brancher Orange Money en premier lieu, puis MTN Mobile Money ou d'autres
// opérateurs, sans modifier le cœur applicatif (facturation, stock, abonnements).
export interface FournisseurPaiementMobile {
  initier(params: InitierParams): Promise<{ referenceFournisseur: string }>;
  consulterStatut(referenceFournisseur: string): Promise<StatutFournisseur>;
}
