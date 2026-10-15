export interface LigneTicketEscPos {
  libelle: string;
  montant: number;
}

export interface TicketEscPosInput {
  entreprise: { nom: string; devise: string; mentionsLegales: string | null };
  site: { nom: string; adresse: string | null };
  operation: string;
  numeroAbonnement: number | null;
  lignes: LigneTicketEscPos[];
  total: number;
  montantTaxe: number;
  modePaiement: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";
  montantEncaisse: number;
  dateHeure: string;
}

const LIBELLE_MODE_PAIEMENT: Record<TicketEscPosInput["modePaiement"], string> = {
  CASH: "Comptant",
  CHEQUE: "Chèque",
  VIREMENT: "Virement bancaire",
  MOBILE_MONEY: "Mobile Money",
};

const formateurFcfa = new Intl.NumberFormat("fr-FR");
const formateurDateHeure = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

// Commandes ESC/POS — cf. spécification Epson ESC/POS (norme de facto des
// imprimantes thermiques 80mm, 11.4).
const INIT = Buffer.from([0x1b, 0x40]); // ESC @ : initialise l'imprimante
const COUPER = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0 : coupe papier totale
function centrer(actif: boolean) {
  return Buffer.from([0x1b, 0x61, actif ? 1 : 0]); // ESC a n
}
function gras(actif: boolean) {
  return Buffer.from([0x1b, 0x45, actif ? 1 : 0]); // ESC E n
}
// Page de codes Windows-1252 (ESC t 16) : les imprimantes thermiques n'impriment pas l'UTF-8 (« Câble »
// en 43 c3 a2… s'affiche en caractères parasites). Un octet par caractère, pour les accents français.
const PAGE_WPC1252 = Buffer.from([0x1b, 0x74, 16]);

// caractères Windows-1252 situés hors de la plage Latin-1 (0x80–0x9f)
const SPECIFIQUES_WPC1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

// Les textes du ticket viennent de la saisie (libellés, noms) : un caractère de contrôle (ESC p ouvre le
// tiroir-caisse, GS V coupe le papier, LF décale la mise en page) ne doit jamais atteindre l'imprimante.
function encoderTexte(texte: string): Buffer {
  const octets: number[] = [];
  for (const caractere of texte) {
    const code = caractere.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) octets.push(0x20); // contrôle → espace
    else if (code === 0x202f || code === 0x205f || code === 0x3000 || (code >= 0x2000 && code <= 0x200a)) octets.push(0x20); // espaces typographiques (« 2 500 »)
    else if ((code >= 0x200b && code <= 0x200f) || code === 0xfeff) continue; // invisibles : ignorés
    else if (code < 0x100) octets.push(code);
    else octets.push(SPECIFIQUES_WPC1252[code] ?? 0x3f); // hors page de codes : « ? »
  }
  return Buffer.from(octets);
}

function ligne(texte = "") {
  return Buffer.concat([encoderTexte(texte), Buffer.from([0x0a])]);
}
function separateur() {
  return ligne("--------------------------------");
}

// 11.4, 6.7 : "Compatibilité imprimante thermique 80mm (protocole ESC/POS)
// pour les tickets de caisse" — remplace window.print() par des commandes
// binaires directement compréhensibles par une imprimante thermique
// réseau, quand une est configurée pour le site (site.imprimante_hote).
export function construireTicketEscPos(donnees: TicketEscPosInput): Buffer {
  const montantHT = donnees.total - donnees.montantTaxe;
  const taxeApplicable = donnees.montantTaxe !== 0;
  const monnaieRendue = donnees.modePaiement === "CASH" ? Math.max(0, donnees.montantEncaisse - donnees.total) : 0;
  const soldeDu = Math.max(0, donnees.total - donnees.montantEncaisse);

  const morceaux: Buffer[] = [INIT, PAGE_WPC1252, centrer(true), gras(true), ligne(donnees.entreprise.nom), gras(false), ligne(donnees.site.nom)];
  if (donnees.site.adresse) morceaux.push(ligne(donnees.site.adresse));
  morceaux.push(centrer(false), separateur());
  morceaux.push(ligne(formateurDateHeure.format(new Date(donnees.dateHeure))));
  morceaux.push(ligne(donnees.numeroAbonnement !== null ? `${donnees.operation} — abonnement n° ${donnees.numeroAbonnement}` : donnees.operation));
  morceaux.push(separateur());

  for (const l of donnees.lignes) {
    morceaux.push(ligne(`${l.libelle}  ${formateurFcfa.format(l.montant)}`));
  }
  morceaux.push(separateur());

  if (taxeApplicable) {
    morceaux.push(ligne(`Total HT  ${formateurFcfa.format(montantHT)}`));
    morceaux.push(ligne(`dont TVA  ${formateurFcfa.format(donnees.montantTaxe)}`));
  }
  morceaux.push(gras(true));
  morceaux.push(ligne(`TOTAL${taxeApplicable ? " TTC" : ""}  ${formateurFcfa.format(donnees.total)} ${donnees.entreprise.devise}`));
  morceaux.push(gras(false));
  morceaux.push(ligne(`${LIBELLE_MODE_PAIEMENT[donnees.modePaiement]}  ${formateurFcfa.format(donnees.montantEncaisse)}`));
  if (monnaieRendue > 0) morceaux.push(ligne(`Monnaie rendue  ${formateurFcfa.format(monnaieRendue)}`));
  if (soldeDu > 0) morceaux.push(ligne(`Solde restant dû  ${formateurFcfa.format(soldeDu)}`));

  morceaux.push(separateur(), centrer(true));
  morceaux.push(ligne(donnees.entreprise.mentionsLegales || "Merci de votre confiance."));
  morceaux.push(ligne(), ligne(), COUPER);

  return Buffer.concat(morceaux);
}
