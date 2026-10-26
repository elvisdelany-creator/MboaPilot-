export type EtatEncaissement = { type: "TOTAL" } | { type: "PARTIEL"; encaisse: number; reste: number } | { type: "ATTENTE" };

// 6.4 : « dès qu'un encaissement, même partiel, est enregistré, la facture passe à VALIDÉE ». Le statut ne dit donc pas si la vente
// est soldée : un acompte de 3 000 sur 5 000 donne une facture validée. Le message de fin de vente s'appuie sur cet état, sinon un
// caissier lit « facture encaissée » et ne voit pas qu'il reste 2 000 FCFA à recevoir.
export function classerEncaissement(total: number, montantEncaisse: number, statutFacture: "BROUILLON" | "VALIDEE"): EtatEncaissement {
  if (total <= 0) return { type: "TOTAL" };
  if (statutFacture !== "VALIDEE" || montantEncaisse <= 0) return { type: "ATTENTE" };
  if (montantEncaisse >= total) return { type: "TOTAL" };
  return { type: "PARTIEL", encaisse: montantEncaisse, reste: total - montantEncaisse };
}
