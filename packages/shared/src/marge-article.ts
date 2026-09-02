export type MargeType = "VALEUR" | "POURCENTAGE";

export interface MargeArticle {
  margeType: MargeType;
  coutRevient: number;
  margeValeur: number | null;
  margePourcentage: number | null; // centièmes de %, ex. 1500 = 15,00 %
}

export interface MargeCalculee {
  margeValeur: number;
  margePourcentage: number;
  prixSuggere: number;
}

// 6.1 : marge_type détermine le mode de saisie actif ; l'autre valeur est
// toujours recalculée pour rester interchangeable sans perte d'information.
export function calculerMarge(article: MargeArticle): MargeCalculee {
  if (article.margeType === "VALEUR") {
    const margeValeur = article.margeValeur ?? 0;
    const margePourcentage = article.coutRevient === 0 ? 0 : Math.round((margeValeur / article.coutRevient) * 10000);
    return { margeValeur, margePourcentage, prixSuggere: article.coutRevient + margeValeur };
  }

  const margePourcentage = article.margePourcentage ?? 0;
  const margeValeur = Math.round((article.coutRevient * margePourcentage) / 10000);
  return { margeValeur, margePourcentage, prixSuggere: article.coutRevient + margeValeur };
}
