import { construireCsv } from "./csv.js";
import { heureDouala, jourDouala } from "./jour-douala.js";

// États de gestion imprimables (état des ventes, de caisse, du stock…). Le serveur construit un `EtatImprimable` ; l'écran, le CSV et le PDF en sont
// trois rendus : les chiffres sont calculés (et testés) une seule fois, les trois sorties ne peuvent pas se contredire.

export type TypeColonneEtat = "texte" | "entier" | "fcfa" | "date";

export interface ColonneEtat {
  cle: string;
  libelle: string;
  type: TypeColonneEtat;
  alignement: "gauche" | "droite";
  // largeur relative d'une colonne de texte dans le PDF (les autres types ont une largeur fixe) ; 1 par défaut
  poids?: number;
}

export interface SectionEtat {
  titre: string;
  colonnes: ColonneEtat[];
  lignes: (string | number)[][]; // mêmes colonnes, dans le même ordre
  totaux?: (string | number)[]; // ligne de totaux, mêmes colonnes ; le libellé (« Total ») est dans la première
  messageVide?: string; // montré quand `lignes` est vide
}

export interface EtatImprimable {
  identifiant: string; // « etat-des-ventes » : sert aussi à nommer les fichiers
  titre: string; // « État des ventes »
  periode: { du: string; au: string }; // AAAA-MM-JJ, jours de Douala
  entete: { nomBoutique: string; lignesContact: string[] };
  genereLe: string; // horodatage ISO
  sections: SectionEtat[];
  avertissements: string[]; // par exemple « Détail limité aux 5 000 premières factures… »
}

const formateurNombre = new Intl.NumberFormat("fr-FR");

const FORME_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const versDateFrancaise = (jour: string) => jour.split("-").reverse().join("/");

// Un texte placé dans une colonne de nombres (la ligne « Total ») reste un texte ; un nombre n'est mis en forme que dans une colonne de nombres.
// Le vrai signe moins (U+2212) que certaines versions d'ICU emploient est ramené au tiret : il n'existe pas dans la police standard du PDF.
export function formaterValeurEtat(valeur: string | number, type: TypeColonneEtat): string {
  if ((type === "entier" || type === "fcfa") && typeof valeur === "number") return formateurNombre.format(valeur).replace(/\u2212/g, "-");
  if (type === "date" && typeof valeur === "string" && FORME_JOUR.test(valeur)) return versDateFrancaise(valeur);
  return String(valeur);
}

export function libellePeriodeEtat(periode: { du: string; au: string }): string {
  return periode.du === periode.au ? `le ${versDateFrancaise(periode.du)}` : `du ${versDateFrancaise(periode.du)} au ${versDateFrancaise(periode.au)}`;
}

// « 17/11/2026 15:21 », à l'heure de Douala
export function dateHeureDouala(instantIso: string): string {
  return `${versDateFrancaise(jourDouala(instantIso))} ${heureDouala(instantIso)}`;
}

export function nomFichierEtat(etat: EtatImprimable, extension: "pdf" | "csv"): string {
  return `${etat.identifiant}-${etat.periode.du}-au-${etat.periode.au}.${extension}`;
}

// Excel en version française attend « ; ». Les montants restent des nombres bruts (Excel les calcule), les dates passent en JJ/MM/AAAA comme dans
// les journaux comptables. Une section après l'autre, séparées d'une ligne vide.
export function etatVersCsv(etat: EtatImprimable): string {
  const lignes: (string | number)[][] = [
    [etat.titre],
    ["Période", libellePeriodeEtat(etat.periode)],
    ["Boutique", etat.entete.nomBoutique],
    ["Généré le", dateHeureDouala(etat.genereLe)],
  ];
  for (const avertissement of etat.avertissements) lignes.push(["Avertissement", avertissement]);

  for (const section of etat.sections) {
    lignes.push([], [section.titre], section.colonnes.map((c) => c.libelle));
    if (section.lignes.length === 0) lignes.push([section.messageVide ?? "Aucune donnée"]);
    for (const ligne of section.lignes) {
      lignes.push(ligne.map((valeur, i) => (section.colonnes[i]?.type === "date" ? formaterValeurEtat(valeur, "date") : valeur)));
    }
    if (section.totaux) lignes.push(section.totaux);
  }
  return construireCsv([etat.titre], lignes.slice(1), ";");
}
