type EntetesHttp = Record<string, string | string[] | undefined>;

// Adresse du visiteur derrière `sautsProxy` proxys d'hébergeur. Chaque proxy AJOUTE à droite de X-Forwarded-For l'adresse qu'il voit, sans
// retirer ce que le visiteur y a mis : l'adresse la plus à gauche est celle que le visiteur annonce lui-même (falsifiable), seule la droite
// est fiable. On remonte donc d'exactement `sautsProxy` crans depuis la droite. Fastify 5 refuse volontairement la confiance « par nombre de
// sauts » (elle ne vérifie pas le proxy immédiat), d'où ce calcul : sans proxy déclaré, l'en-tête est ignoré.
//
// Réglage trop bas : plusieurs visiteurs partagent l'adresse d'un proxy (plafond collectif, sans danger). Réglage trop haut : une adresse
// inventée par le visiteur peut être retenue (contournement du plafond) — d'où l'ordre de réglage : commencer à 1.
export function adresseDuVisiteur(entetes: EntetesHttp, adresseConnexion: string, sautsProxy: number): string {
  if (sautsProxy <= 0) return adresseConnexion;
  const brut = entetes["x-forwarded-for"];
  const texte = Array.isArray(brut) ? brut.join(",") : brut;
  if (!texte) return adresseConnexion;
  const adresses = texte.split(",").map((a) => a.trim()).filter(Boolean);
  const indice = adresses.length - sautsProxy;
  return indice >= 0 ? adresses[indice] : adresseConnexion;
}

// protocole annoncé par le proxy le plus proche (dernière valeur de X-Forwarded-Proto), seulement si un proxy est déclaré
export function protocoleAnnonce(entetes: EntetesHttp, sautsProxy: number): string | null {
  if (sautsProxy <= 0) return null;
  const brut = entetes["x-forwarded-proto"];
  const texte = Array.isArray(brut) ? brut.join(",") : brut;
  return texte ? (texte.split(",").pop()?.trim().toLowerCase() ?? null) : null;
}
