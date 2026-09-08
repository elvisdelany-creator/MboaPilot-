import { describe, it, expect } from "vitest";
import { chiffrer, dechiffrer } from "./chiffrement.js";

describe("chiffrer / dechiffrer (11.2 : chiffrement des données sensibles au repos)", () => {
  it("déchiffre exactement le texte d'origine", () => {
    const chiffre = chiffrer("boutique@example.cm");
    expect(dechiffrer(chiffre)).toBe("boutique@example.cm");
  });

  it("le texte chiffré ne contient jamais le texte en clair", () => {
    const chiffre = chiffrer("mot-de-passe-secret");
    expect(chiffre).not.toContain("mot-de-passe-secret");
  });

  it("produit un texte chiffré différent à chaque appel (IV aléatoire), mais déchiffre toujours vers la même valeur", () => {
    const chiffre1 = chiffrer("secret");
    const chiffre2 = chiffrer("secret");
    expect(chiffre1).not.toBe(chiffre2);
    expect(dechiffrer(chiffre1)).toBe("secret");
    expect(dechiffrer(chiffre2)).toBe("secret");
  });

  it("gère une chaîne vide", () => {
    expect(dechiffrer(chiffrer(""))).toBe("");
  });
});
