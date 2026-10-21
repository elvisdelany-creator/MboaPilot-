export interface ArticleRecherchable {
  libelle: string;
  codeBarres?: string | null;
}

function normaliser(saisie: string): string {
  return saisie.trim().toLowerCase();
}

// 5.2, 9.2 : filtre de la grille d'articles — libellé ou code-barres contient la saisie
export function filtrerArticles<T extends ArticleRecherchable>(articles: T[], saisie: string): T[] {
  const recherche = normaliser(saisie);
  if (!recherche) return articles;
  return articles.filter((a) => a.libelle.toLowerCase().includes(recherche) || a.codeBarres?.toLowerCase().includes(recherche));
}

export type EntreeRecherche<T> = { action: "ajouter"; article: T } | { action: "inconnu"; saisie: string } | { action: "aucune" };

// Ce que fait la touche Entrée dans la recherche d'article. Une scanette termine sa frappe par Entrée :
// - code-barres exact : l'article est ajouté au ticket ;
// - saisie qui ne correspond à rien (code inconnu) : le champ doit être vidé et le caissier prévenu, sinon le code suivant,
//   valide, se colle derrière le premier et ne correspond plus à rien : la caisse semble refuser tous les articles ;
// - recherche qui a des résultats (libellé, début de code) : rien, le caissier choisit dans la grille.
export function resoudreEntreeRecherche<T extends ArticleRecherchable>(articles: T[], saisie: string): EntreeRecherche<T> {
  const recherche = normaliser(saisie);
  if (!recherche) return { action: "aucune" };
  const exact = articles.find((a) => a.codeBarres?.toLowerCase() === recherche);
  if (exact) return { action: "ajouter", article: exact };
  if (filtrerArticles(articles, saisie).length === 0) return { action: "inconnu", saisie: saisie.trim() };
  return { action: "aucune" };
}
