import { messageRelanceEcheance, type DonneesRelanceEcheance } from "./message-relance.js";
import { telephoneValide } from "./telephone.js";

// Relance d'un client par WhatsApp : un lien wa.me qui ouvre la conversation avec le message déjà écrit. C'est la personne de la boutique qui appuie sur
// « envoyer » depuis son propre WhatsApp : aucun envoi automatique (cela demande un compte WhatsApp Business API, qui n'est pas branché).

// wa.me veut le numéro au format international, chiffres seulement, sans « + » ni « 00 » (« 237677000000 »).
// Un numéro camerounais saisi à la locale (9 chiffres) reçoit l'indicatif 237 ; un numéro étranger doit porter son indicatif (« + » ou « 00 »).
// Un numéro dont on ne peut pas deviner le pays (par exemple 10 chiffres sans indicatif) renvoie null : mieux vaut ne rien proposer que de
// l'envoyer à un inconnu.
export function numeroWhatsApp(saisie: string): string | null {
  const propre = saisie.trim();
  if (!telephoneValide(propre)) return null;
  let chiffres = propre.replace(/\D/g, "");

  if (propre.startsWith("+") || chiffres.startsWith("00")) {
    if (chiffres.startsWith("00")) chiffres = chiffres.slice(2);
    return chiffres.length >= 8 && chiffres.length <= 15 ? chiffres : null;
  }
  if (chiffres.startsWith("237") && chiffres.length === 12) return chiffres;
  if (chiffres.length === 9) return `237${chiffres}`;
  return null;
}

export function lienWhatsApp(telephone: string, message: string): string | null {
  const numero = numeroWhatsApp(telephone);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(message)}` : null;
}

export interface DonneesAbonnementExpire {
  entreprise: string; // nom de la boutique, vide si inconnu
  libelleAbonnement: string; // ex. « CANAL+ EVASION »
  numeroAbonnement: number;
  dateFin: string; // déjà au format JJ/MM/AAAA
}

// campagne de reconquête : l'abonnement est déjà expiré (les relances d'échéance, elles, parlent d'une échéance à venir)
export function messageAbonnementExpire(donnees: DonneesAbonnementExpire): string {
  const boutique = donnees.entreprise.trim();
  const phrase = `votre abonnement ${donnees.libelleAbonnement} n°${donnees.numeroAbonnement} a expiré le ${donnees.dateFin}.`;
  const texte = boutique ? `${boutique} : ${phrase}` : phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return `${texte} Réabonnez-vous pour retrouver vos chaînes.`;
}

// même texte que le SMS de relance, sans la ligne de contact : sur WhatsApp, le client répond directement à la boutique
export function lienWhatsAppRelanceEcheance(donnees: Omit<DonneesRelanceEcheance, "contact"> & { telephone: string }): string | null {
  const { telephone, ...message } = donnees;
  return lienWhatsApp(telephone, messageRelanceEcheance(message));
}

export function lienWhatsAppAbonnementExpire(donnees: DonneesAbonnementExpire & { telephone: string }): string | null {
  const { telephone, ...message } = donnees;
  return lienWhatsApp(telephone, messageAbonnementExpire(message));
}
