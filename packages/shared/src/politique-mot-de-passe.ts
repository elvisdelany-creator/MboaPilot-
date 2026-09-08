export interface PolitiqueMotDePasse {
  longueurMin: number;
  exigerMajuscule: boolean;
  exigerChiffre: boolean;
  exigerCaractereSpecial: boolean;
}

export const POLITIQUE_MDP_PAR_DEFAUT: PolitiqueMotDePasse = {
  longueurMin: 8,
  exigerMajuscule: false,
  exigerChiffre: false,
  exigerCaractereSpecial: false,
};

// 11.2 : "politique de complexité minimale configurable" — chaque règle est
// indépendamment activable (8.8, paramétrage entreprise), désactivée par
// défaut sauf la longueur minimale, pour ne rien imposer de plus strict que
// l'existant tant que l'administrateur ne l'a pas explicitement demandé.
export function validerMotDePasse(motDePasse: string, politique: PolitiqueMotDePasse = POLITIQUE_MDP_PAR_DEFAUT): string[] {
  const erreurs: string[] = [];
  if (motDePasse.length < politique.longueurMin) {
    erreurs.push(`Le mot de passe doit contenir au moins ${politique.longueurMin} caractères`);
  }
  if (politique.exigerMajuscule && !/[A-Z]/.test(motDePasse)) {
    erreurs.push("Le mot de passe doit contenir au moins une majuscule");
  }
  if (politique.exigerChiffre && !/[0-9]/.test(motDePasse)) {
    erreurs.push("Le mot de passe doit contenir au moins un chiffre");
  }
  if (politique.exigerCaractereSpecial && !/[^A-Za-z0-9]/.test(motDePasse)) {
    erreurs.push("Le mot de passe doit contenir au moins un caractère spécial");
  }
  return erreurs;
}
