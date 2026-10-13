// 2.5.1 : identifiant de connexion d'un compte utilisateur. Règle partagée par l'API (qui la fait
// respecter) et par le formulaire de création de compte (qui l'annonce et la vérifie en direct).

// lettres latines sans accent, chiffres et . _ - @ — jamais d'espace, de caractère de contrôle ou de
// lettre d'un autre alphabet (un « а » cyrillique est identique à l'œil à un « a » latin : deux
// comptes « admin » distincts permettraient l'usurpation)
const FORME_IDENTIFIANT = /^[a-z0-9._@-]{3,50}$/;

export const AIDE_IDENTIFIANT_CONNEXION =
  "L'identifiant doit contenir de 3 à 50 caractères : lettres sans accent, chiffres, point, tiret, tiret bas ou @ (ni espace ni autre symbole)";

// espaces retirés, minuscules : « Admin », « ADMIN » et « admin » désignent le même compte
export function normaliserIdentifiant(identifiant: string): string {
  return identifiant.trim().toLowerCase();
}

// Message d'erreur, ou null si l'identifiant est valide. Un champ vide n'est pas signalé ici : l'obligation
// de le renseigner est un autre message.
export function erreurIdentifiantConnexion(identifiant: string): string | null {
  const normalise = normaliserIdentifiant(identifiant);
  if (!normalise) return null;
  return FORME_IDENTIFIANT.test(normalise) ? null : AIDE_IDENTIFIANT_CONNEXION;
}
