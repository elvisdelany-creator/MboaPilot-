import { describe, expect, it } from "vitest";
import { filtrerArticles, resoudreEntreeRecherche } from "./saisie-recherche-article.js";

const ARTICLES = [
  { libelle: "Câble HDMI", codeBarres: "6001234567890" },
  { libelle: "Télécommande", codeBarres: "6009876543210" },
  { libelle: "Installation", codeBarres: null },
  { libelle: "Antenne", codeBarres: undefined },
];

// Constaté en test grandeur nature avec une scanette : un code-barres inconnu restait dans le champ sans aucun message, et
// le code suivant, valide, se collait derrière lui (« 11111111111116001234567890 ») et ne correspondait plus à rien : la caisse
// semblait refuser tous les articles.
describe("resoudreEntreeRecherche : touche Entrée dans la recherche d'article", () => {
  it("ajoute l'article dont le code-barres correspond exactement, sans tenir compte de la casse ni des espaces autour", () => {
    expect(resoudreEntreeRecherche(ARTICLES, "6001234567890")).toEqual({ action: "ajouter", article: ARTICLES[0] });
    expect(resoudreEntreeRecherche(ARTICLES, "  6009876543210 ")).toEqual({ action: "ajouter", article: ARTICLES[1] });
  });

  it("signale un code inconnu, pour vider le champ et prévenir le caissier", () => {
    expect(resoudreEntreeRecherche(ARTICLES, "1111111111111")).toEqual({ action: "inconnu", saisie: "1111111111111" });
  });

  it("un code scanné par-dessus un reste de saisie ne correspond à rien : inconnu aussi", () => {
    expect(resoudreEntreeRecherche(ARTICLES, "11111111111116001234567890")).toEqual({ action: "inconnu", saisie: "11111111111116001234567890" });
  });

  it("ne fait rien quand la saisie est une recherche qui a des résultats (libellé, début de code)", () => {
    expect(resoudreEntreeRecherche(ARTICLES, "câble")).toEqual({ action: "aucune" });
    expect(resoudreEntreeRecherche(ARTICLES, "60012")).toEqual({ action: "aucune" });
  });

  it("ne fait rien sur une saisie vide", () => {
    expect(resoudreEntreeRecherche(ARTICLES, "")).toEqual({ action: "aucune" });
    expect(resoudreEntreeRecherche(ARTICLES, "   ")).toEqual({ action: "aucune" });
  });

  it("un article sans code-barres n'est jamais trouvé par un code", () => {
    expect(resoudreEntreeRecherche(ARTICLES, "undefined")).toEqual({ action: "inconnu", saisie: "undefined" });
    expect(resoudreEntreeRecherche(ARTICLES, "null")).toEqual({ action: "inconnu", saisie: "null" });
  });
});

describe("filtrerArticles : filtre de la grille", () => {
  it("renvoie tout sans saisie", () => {
    expect(filtrerArticles(ARTICLES, "")).toHaveLength(4);
    expect(filtrerArticles(ARTICLES, "  ")).toHaveLength(4);
  });

  it("filtre par libellé ou par code-barres, sans tenir compte de la casse", () => {
    expect(filtrerArticles(ARTICLES, "CÂBLE").map((a) => a.libelle)).toEqual(["Câble HDMI"]);
    expect(filtrerArticles(ARTICLES, "98765").map((a) => a.libelle)).toEqual(["Télécommande"]);
  });
});
