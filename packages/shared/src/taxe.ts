// 6.1, 8.8 : taux en centièmes de %, comme margePourcentage (ex. 1925 = 19,25 %)
// — null signifie qu'aucune taxe n'est applicable (paramétrage "le cas échéant").
export function calculerMontantTaxe(montantHT: number, tauxTva: number | null): number {
  if (tauxTva === null) return 0;
  return Math.round((montantHT * tauxTva) / 10000);
}

// 3.2.3 : "porte le total, la TVA/taxes le cas échéant" — le prix catalogue
// saisi est réputé TTC (jamais un HT auquel la taxe s'ajouterait, cf.
// FactureProFormaPrintable/RecuVentePrintable) ; extrait la part de taxe déjà
// incluse dans un montant, pour l'historiser sur la facture au moment de sa
// création plutôt que de la recalculer après coup avec un taux qui aurait
// changé depuis (8.8, paramétrage modifiable).
export function extraireTaxeDuTTC(montantTTC: number, tauxTva: number | null): number {
  if (tauxTva === null) return 0;
  const montantHT = Math.round((montantTTC * 10000) / (10000 + tauxTva));
  return montantTTC - montantHT;
}
