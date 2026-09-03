// 6.1, 8.8 : taux en centièmes de %, comme margePourcentage (ex. 1925 = 19,25 %)
// — null signifie qu'aucune taxe n'est applicable (paramétrage "le cas échéant").
export function calculerMontantTaxe(montantHT: number, tauxTva: number | null): number {
  if (tauxTva === null) return 0;
  return Math.round((montantHT * tauxTva) / 10000);
}
