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
function ligne(texte = "") {
  return Buffer.from(texte + "\n", "utf8");
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

  const morceaux: Buffer[] = [INIT, centrer(true), gras(true), ligne(donnees.entreprise.nom), gras(false), ligne(donnees.site.nom)];
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
