// Numéro de téléphone saisi (client, apporteur, paiement mobile…) : chiffres, espaces et + ( ) . - seulement,
// de 6 à 15 chiffres (norme E.164, indicatif compris). « abcdef » ou un texte de 5 000 caractères n'est pas un
// numéro que l'on peut appeler. Règle partagée par l'API (qui la fait respecter) et par les formulaires
// (qui la vérifient pendant la saisie).
const CARACTERES_TELEPHONE = /^[0-9 +().-]+$/;

export const MESSAGE_FORME_TELEPHONE = "doit contenir de 6 à 15 chiffres (espaces, +, ( ), . et - autorisés)";

export function telephoneValide(telephone: string): boolean {
  const propre = telephone.trim();
  if (propre === "" || !CARACTERES_TELEPHONE.test(propre)) return false;
  const nbChiffres = propre.replace(/\D/g, "").length;
  return nbChiffres >= 6 && nbChiffres <= 15;
}
