// Détails exigés pour encaisser par chèque ou par virement. Règle partagée par l'API (qui la fait respecter, quel que soit le client qui l'appelle)
// et par les écrans d'encaissement (qui la vérifient pendant la saisie). Sans elle, un chèque sans numéro ou un virement sans référence ne se
// rapproche plus du relevé de banque.
export interface DetailsPaiement {
  mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";
  banque?: string | null;
  numeroCheque?: string | null;
  titulaireCheque?: string | null;
  dateCheque?: string | null; // AAAA-MM-JJ
  referenceVirement?: string | null;
}

const LONGUEUR_MAX_BANQUE = 100;
const LONGUEUR_MAX_NUMERO_CHEQUE = 50;
const LONGUEUR_MAX_TITULAIRE = 100;
const LONGUEUR_MAX_REFERENCE_VIREMENT = 100;

const DATE_CHEQUE_PLUS_ANCIENNE = "2000-01-01";
const JOURS_MAX_POSTDATE = 366; // un chèque postdaté d'un an au plus reste courant ; au-delà, c'est une faute de frappe
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

const FORME_DATE = /^\d{4}-\d{2}-\d{2}$/;

// une date réelle du calendrier (« 2026-02-30 » n'en est pas une)
function dateReelle(valeur: string): boolean {
  if (!FORME_DATE.test(valeur)) return false;
  const date = new Date(`${valeur}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === valeur;
}

function erreurTexte(valeur: unknown, nom: string, longueurMax: number): string | null {
  if (valeur === undefined || valeur === null) return `${nom} est obligatoire`;
  if (typeof valeur !== "string") return `${nom} doit être un texte`;
  const propre = valeur.trim();
  if (propre === "") return `${nom} est obligatoire`;
  if (propre.length > longueurMax) return `${nom} ne peut pas dépasser ${longueurMax} caractères`;
  return null;
}

function erreurDateCheque(valeur: unknown, aujourdHui: string): string | null {
  if (valeur === undefined || valeur === null || valeur === "") return "La date du chèque est obligatoire";
  if (typeof valeur !== "string" || !dateReelle(valeur)) return "La date du chèque doit être une date valide (AAAA-MM-JJ)";
  if (valeur < DATE_CHEQUE_PLUS_ANCIENNE) return "La date du chèque est trop ancienne";
  const limite = new Date(Date.parse(`${aujourdHui}T00:00:00Z`) + JOURS_MAX_POSTDATE * MS_PAR_JOUR).toISOString().slice(0, 10);
  if (valeur > limite) return "La date du chèque est trop lointaine : un chèque postdaté ne dépasse pas un an";
  return null;
}

// null si les détails conviennent au mode de paiement, sinon le message à montrer à la personne qui encaisse.
// `aujourdHui` : jour de Douala (AAAA-MM-JJ), pour borner la date d'un chèque postdaté.
export function erreurDetailsPaiement(details: DetailsPaiement, aujourdHui: string): string | null {
  if (details.mode === "CHEQUE") {
    return (
      erreurTexte(details.banque, "La banque", LONGUEUR_MAX_BANQUE) ??
      erreurTexte(details.numeroCheque, "Le numéro du chèque", LONGUEUR_MAX_NUMERO_CHEQUE) ??
      erreurTexte(details.titulaireCheque, "Le titulaire du chèque", LONGUEUR_MAX_TITULAIRE) ??
      erreurDateCheque(details.dateCheque, aujourdHui)
    );
  }
  if (details.mode === "VIREMENT") {
    return erreurTexte(details.banque, "La banque", LONGUEUR_MAX_BANQUE) ?? erreurTexte(details.referenceVirement, "La référence du virement", LONGUEUR_MAX_REFERENCE_VIREMENT);
  }
  return null;
}
