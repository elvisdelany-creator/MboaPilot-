import { describe, it, expect } from "vitest";
import { lireEntierSaisi } from "./saisie-entier.js";

// Constaté en test grandeur nature : les formulaires de paramètres convertissaient les champs avec
// Number(texte), et Number("") vaut 0. Vider le « taux de garantie » (50 %) l'enregistrait donc à 0 %
// — les réparations sous garantie devenaient gratuites — sans aucun message.
describe("lireEntierSaisi", () => {
  it.each([
    ["50", 50],
    ["  12  ", 12],
    ["0", 0],
    ["-3", -3],
    ["007", 7],
  ])("lit « %s » comme l'entier %d", (texte, attendu) => {
    expect(lireEntierSaisi(texte, "Le taux")).toBe(attendu);
  });

  it.each(["", "   "])("refuse un champ vide (« %s ») au lieu de le lire comme 0", (texte) => {
    expect(() => lireEntierSaisi(texte, "Le taux de garantie")).toThrow("Le taux de garantie est obligatoire");
  });

  it.each(["abc", "12,5", "12.5", "1e3", "5 000", "+5", "--3", "9007199254740993"])("refuse « %s » : ce n'est pas un nombre entier", (texte) => {
    expect(() => lireEntierSaisi(texte, "Le taux")).toThrow("Le taux doit être un nombre entier");
  });
});
