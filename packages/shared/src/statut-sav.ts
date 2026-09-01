export type StatutSav = "RECU" | "DIAGNOSTIC" | "DEVIS_ATTENTE" | "REPARATION" | "PRET" | "LIVRE" | "IRREPARABLE" | "ABANDONNE";

// 5.10 : graphe des transitions valides du dossier SAV. LIVRE, IRREPARABLE et
// ABANDONNE sont des états terminaux. Le devis (DEVIS_ATTENTE) est optionnel :
// DIAGNOSTIC peut aller directement en REPARATION.
const TRANSITIONS: Record<StatutSav, StatutSav[]> = {
  RECU: ["DIAGNOSTIC", "IRREPARABLE", "ABANDONNE"],
  DIAGNOSTIC: ["DEVIS_ATTENTE", "REPARATION", "IRREPARABLE", "ABANDONNE"],
  DEVIS_ATTENTE: ["REPARATION", "IRREPARABLE", "ABANDONNE"],
  REPARATION: ["PRET", "IRREPARABLE", "ABANDONNE"],
  PRET: ["LIVRE"],
  LIVRE: [],
  IRREPARABLE: [],
  ABANDONNE: [],
};

export function peutTransitionnerSav(statutActuel: StatutSav, statutCible: StatutSav): boolean {
  return TRANSITIONS[statutActuel].includes(statutCible);
}
