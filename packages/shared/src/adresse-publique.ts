// Adresse publique de vérification : le QR code du ticket encode un lien que le client scanne avec son téléphone. Sans
// adresse atteignable de l'extérieur du poste de caisse (nom de domaine ou tunnel vers le poste), le lien est mort.
// Règle partagée entre l'API (contrôle à l'enregistrement) et l'interface (aide à la saisie).

const LONGUEUR_MAX = 200;

// adresses qui ne désignent que le poste lui-même : jamais joignables depuis le téléphone d'un client
function estAdresseDuPoste(hote: string): boolean {
  const h = hote.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0" || h === "::1" || h === "::" || /^127\./.test(h);
}

// null = valide, ou vide (aucune adresse : le QR n'est pas imprimé) ; sinon le message à afficher
export function erreurAdressePublique(valeur: string): string | null {
  const propre = valeur.trim();
  if (propre === "") return null;
  if (propre.length > LONGUEUR_MAX) return `L'adresse ne peut pas dépasser ${LONGUEUR_MAX} caractères`;

  let url: URL;
  try {
    url = new URL(propre);
  } catch {
    return /^[a-z][a-z0-9+.-]*:/i.test(propre) || propre.includes(" ")
      ? "L'adresse n'est pas valide (exemple : https://verif.maboutique.cm)"
      : "L'adresse doit commencer par http:// ou https:// (exemple : https://verif.maboutique.cm)";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "L'adresse doit commencer par http:// ou https://";
  if (url.hostname === "") return "L'adresse n'est pas valide : il manque le nom de domaine";
  if (url.username !== "" || url.password !== "") return "L'adresse ne doit contenir ni identifiant ni mot de passe";
  if (estAdresseDuPoste(url.hostname)) {
    return "Cette adresse ne désigne que le poste de caisse : un client ne pourrait pas l'ouvrir depuis son téléphone. Indiquez l'adresse publique (nom de domaine ou tunnel)";
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "") {
    return "L'adresse ne doit comporter que le domaine (et le port), sans chemin ni paramètre : la racine du site";
  }
  return null;
}

// origine normalisée (domaine en minuscules, sans barre finale) ; null si la saisie est vide. À n'appeler qu'après
// avoir vérifié erreurAdressePublique.
export function normaliserAdressePublique(valeur: string): string | null {
  const propre = valeur.trim();
  return propre === "" ? null : new URL(propre).origin;
}

// lien encodé dans le QR du ticket
export function construireUrlVerification(adressePublique: string, idFacture: number, jeton: string): string {
  return `${adressePublique}/verification/${idFacture}/${jeton}`;
}
