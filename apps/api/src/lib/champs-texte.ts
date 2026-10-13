// Nettoyage et contrôle des champs texte venus de l'API : les types TypeScript n'existent pas à
// l'exécution, et rien n'empêchait un nom de 100 000 caractères, un téléphone « abcdef » ou un
// e-mail « pas-un-email » d'être enregistré tel quel.

const CARACTERES_TELEPHONE = /^[0-9 +().-]+$/;
const FORME_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Texte nettoyé (espaces autour retirés). `undefined` = champ absent ; chaîne vide = non renseigné.
function texteNettoye(valeur: unknown, libelle: string, longueurMax: number): string | undefined {
  if (valeur === undefined) return undefined;
  if (typeof valeur !== "string") throw new Error(`${libelle} doit être un texte`);
  const propre = valeur.trim();
  if (propre.length > longueurMax) throw new Error(`${libelle} ne peut pas dépasser ${longueurMax} caractères`);
  return propre;
}

// champ obligatoire : le message « est obligatoire » prime sur tout autre contrôle
export function texteObligatoire(valeur: unknown, libelle: string, longueurMax: number): string {
  if (typeof valeur === "string" && !valeur.trim()) throw new Error(`${libelle} est obligatoire`);
  const propre = texteNettoye(valeur ?? undefined, libelle, longueurMax);
  if (propre === undefined) throw new Error(`${libelle} est obligatoire`);
  return propre;
}

// champ facultatif : undefined = absent (rien à changer) ; null ou texte vide = « non renseigné » (null)
export function texteFacultatif(valeur: unknown, libelle: string, longueurMax: number): string | null | undefined {
  if (valeur === null) return null;
  const propre = texteNettoye(valeur, libelle, longueurMax);
  return propre === undefined ? undefined : propre === "" ? null : propre;
}

// chiffres, espaces et + ( ) . - seulement, de 6 à 15 chiffres (norme E.164, indicatif compris) :
// « abcdef » ou un texte de 5 000 caractères n'est pas un numéro que l'on peut appeler
function verifierFormeTelephone(propre: string, libelle: string): string {
  const nbChiffres = propre.replace(/\D/g, "").length;
  if (!CARACTERES_TELEPHONE.test(propre) || nbChiffres < 6 || nbChiffres > 15) {
    throw new Error(`${libelle} doit contenir de 6 à 15 chiffres (espaces, +, ( ), . et - autorisés)`);
  }
  return propre;
}

export function telephoneObligatoire(valeur: unknown, libelle: string): string {
  return verifierFormeTelephone(texteObligatoire(valeur, libelle, 30), libelle);
}

export function telephoneFacultatif(valeur: unknown, libelle: string): string | null | undefined {
  const propre = texteFacultatif(valeur, libelle, 30);
  return typeof propre === "string" ? verifierFormeTelephone(propre, libelle) : propre;
}

export function emailFacultatif(valeur: unknown, libelle: string): string | null | undefined {
  const propre = texteFacultatif(valeur, libelle, 254);
  if (typeof propre === "string" && !FORME_EMAIL.test(propre)) throw new Error(`${libelle} n'est pas valide`);
  return propre;
}

// Contrôle de type et de longueur SANS nettoyage : pour un secret (mot de passe), les espaces en font partie.
export function verifierLongueurTexte(valeur: unknown, libelle: string, longueurMax: number): void {
  if (valeur === undefined) return;
  if (typeof valeur !== "string") throw new Error(`${libelle} doit être un texte`);
  if (valeur.length > longueurMax) throw new Error(`${libelle} ne peut pas dépasser ${longueurMax} caractères`);
}
