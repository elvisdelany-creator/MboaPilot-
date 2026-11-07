// Brouillon du ticket de caisse : le caissier construit un ticket, va consulter un client ou le stock, revient — ou recharge la page
// par mégarde. Sans brouillon, le ticket (client choisi, lignes, remise) est perdu. Ce module ne fait que décider quoi garder et
// relire sans risque ce qui a été gardé : un stockage ancien, trafiqué ou corrompu ne doit jamais remplir la caisse de valeurs
// impossibles, ni faire revenir une vente de la veille.

export const DUREE_BROUILLON_CAISSE_MS = 12 * 60 * 60 * 1000;

const VERSION = 1;
const QUANTITE_MAX_PAR_LIGNE = 9999;
const LONGUEUR_MAX_SERIE = 100;
// l'horloge du poste peut avancer de quelques minutes entre deux lectures ; au-delà, la date enregistrée n'est pas crédible
const TOLERANCE_HORLOGE_MS = 5 * 60 * 1000;

export interface LigneBrouillonCaisse {
  idProduit: number;
  quantite: number;
  remise: number;
}

export interface BrouillonCaisse {
  // fiche complète d'un client existant, ou nouveau client à créer à la validation : conservée telle quelle
  abonne: ({ nom: string; prenom: string; telephone: string } & Record<string, unknown>) | null;
  idFamille: number | null;
  idFormule: number | null;
  idKit: number | null;
  idsOptions: number[];
  numeroSerie: string;
  remise: number;
  modeProduits: boolean;
  lignes: LigneBrouillonCaisse[];
}

// choisir une famille ou le mode produits est l'état par défaut d'une caisse qui s'ouvre : seul un vrai début de vente se garde
export function brouillonCaisseEstVide(b: BrouillonCaisse): boolean {
  return (
    b.abonne === null &&
    b.idFormule === null &&
    b.idKit === null &&
    b.idsOptions.length === 0 &&
    b.lignes.length === 0 &&
    b.numeroSerie.trim() === "" &&
    b.remise === 0
  );
}

// null pour un ticket vide : l'appelant efface alors le brouillon au lieu d'en écrire un
export function serialiserBrouillonCaisse(brouillon: BrouillonCaisse, maintenant: number): string | null {
  if (brouillonCaisseEstVide(brouillon)) return null;
  return JSON.stringify({ v: VERSION, enregistreLe: maintenant, brouillon });
}

const entierPositif = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const entierPositifOuNul = (v: unknown): v is number | null => v === null || entierPositif(v);
const montantValide = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const objet = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function brouillonValide(valeur: unknown): valeur is BrouillonCaisse {
  if (!objet(valeur)) return false;
  const { abonne, idFamille, idFormule, idKit, idsOptions, numeroSerie, remise, modeProduits, lignes } = valeur;
  if (abonne !== null && !(objet(abonne) && typeof abonne.nom === "string" && typeof abonne.prenom === "string" && typeof abonne.telephone === "string")) return false;
  if (![idFamille, idFormule, idKit].every(entierPositifOuNul)) return false;
  if (!Array.isArray(idsOptions) || !idsOptions.every(entierPositif)) return false;
  if (typeof numeroSerie !== "string" || numeroSerie.length > LONGUEUR_MAX_SERIE) return false;
  if (!montantValide(remise) || typeof modeProduits !== "boolean") return false;
  if (!Array.isArray(lignes)) return false;
  return lignes.every((l) => objet(l) && entierPositif(l.idProduit) && entierPositif(l.quantite) && l.quantite <= QUANTITE_MAX_PAR_LIGNE && montantValide(l.remise));
}

export function lireBrouillonCaisse(brut: string | null, maintenant: number): BrouillonCaisse | null {
  if (!brut) return null;
  let enveloppe: unknown;
  try {
    enveloppe = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!objet(enveloppe) || enveloppe.v !== VERSION || typeof enveloppe.enregistreLe !== "number") return null;
  const age = maintenant - enveloppe.enregistreLe;
  if (age > DUREE_BROUILLON_CAISSE_MS || age < -TOLERANCE_HORLOGE_MS) return null;
  return brouillonValide(enveloppe.brouillon) ? enveloppe.brouillon : null;
}
