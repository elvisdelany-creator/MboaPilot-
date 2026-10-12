// 9.4 : solde restant dû sur les factures d'un client.
export interface FactureSolde {
  idFacture: number;
  type: "VENTE" | "AVOIR";
  montantTotal: number; // négatif pour un avoir
  factureOrigineId: number | null;
}

export interface PaiementSolde {
  idFacture: number;
  montant: number;
}

// 6.4 : un avoir émis sur la facture (montant négatif) corrige déjà le montant dû — l'ignorer ferait
// apparaître comme impayé un montant que l'avoir a précisément pour but d'annuler. Négatif quand la
// facture, déjà payée, est créditée : c'est alors un remboursement dû au client.
export function soldeFacture(facture: FactureSolde, factures: FactureSolde[], paiements: PaiementSolde[]): number {
  const totalPaye = paiements.filter((p) => p.idFacture === facture.idFacture).reduce((total, p) => total + p.montant, 0);
  const totalAvoirs = factures.filter((autre) => autre.factureOrigineId === facture.idFacture).reduce((total, avoir) => total + avoir.montantTotal, 0);
  return facture.montantTotal + totalAvoirs - totalPaye;
}

// Total que le client doit encore : somme des soldes positifs des factures de vente. Une facture d'avoir
// n'est jamais comptée (elle est déjà déduite de sa facture d'origine), et un remboursement dû sur une
// facture ne vient pas réduire ce que le client doit sur une autre.
export function soldeTotalDu(factures: FactureSolde[], paiements: PaiementSolde[]): number {
  return factures
    .filter((f) => f.type === "VENTE")
    .reduce((total, f) => total + Math.max(0, soldeFacture(f, factures, paiements)), 0);
}
