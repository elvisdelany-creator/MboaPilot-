// Lecture d'un entier saisi dans un champ de formulaire. Number("") vaut 0 : un champ vidé par erreur
// était enregistré comme 0 (le taux de garantie à 0 % rendait les réparations sous garantie gratuites).
// Un champ vide est donc refusé, avec un message qui nomme le champ.
export function lireEntierSaisi(texte: string, libelle: string): number {
  const propre = texte.trim();
  if (propre === "") throw new Error(`${libelle} est obligatoire`);
  if (!/^-?\d+$/.test(propre) || !Number.isSafeInteger(Number(propre))) throw new Error(`${libelle} doit être un nombre entier`);
  return Number(propre);
}
