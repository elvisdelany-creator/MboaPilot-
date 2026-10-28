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

// Chiffres significatifs d'un numéro, sans indicatif du pays (Cameroun : 237, éventuellement précédé de 00) ni séparateurs.
function chiffresSignificatifs(telephone: string): string {
  let chiffres = telephone.replace(/\D/g, "");
  if (chiffres.startsWith("00")) chiffres = chiffres.slice(2);
  if (chiffres.startsWith("237") && chiffres.length > 9) chiffres = chiffres.slice(3);
  return chiffres;
}

// 7.1 : « si le client existe déjà (recherche par téléphone…), sa fiche existante est sélectionnée » : deux saisies d'un même numéro
// (« 677123456 », « +237 677 12 34 56 ») doivent se reconnaître. Un numéro trop court pour être valide ne ressemble à aucun autre.
export function memeTelephone(a: string, b: string): boolean {
  const x = chiffresSignificatifs(a);
  const y = chiffresSignificatifs(b);
  return x.length >= 6 && x === y;
}
