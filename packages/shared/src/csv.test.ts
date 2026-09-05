import { describe, it, expect } from "vitest";
import { analyserCsv, construireCsv } from "./csv.js";

describe("analyserCsv (8.2 : import de catalogue)", () => {
  it("découpe un CSV simple en objets indexés par en-tête", () => {
    const lignes = analyserCsv("Libelle,PrixVente\nTélécommande,2500\nCâble HDMI,1500");
    expect(lignes).toEqual([
      { Libelle: "Télécommande", PrixVente: "2500" },
      { Libelle: "Câble HDMI", PrixVente: "1500" },
    ]);
  });

  it("gère les champs entre guillemets contenant des virgules", () => {
    const lignes = analyserCsv('Libelle,Categorie\n"Décodeur, modèle G11",Décodeurs');
    expect(lignes).toEqual([{ Libelle: "Décodeur, modèle G11", Categorie: "Décodeurs" }]);
  });

  it("gère les guillemets échappés (\"\") à l'intérieur d'un champ entre guillemets", () => {
    const lignes = analyserCsv('Libelle\n"Support ""mural"" universel"');
    expect(lignes).toEqual([{ Libelle: 'Support "mural" universel' }]);
  });

  it("ignore les fins de ligne CRLF et les lignes vides en fin de fichier", () => {
    const lignes = analyserCsv("Libelle,PrixVente\r\nStylo,300\r\n\r\n");
    expect(lignes).toEqual([{ Libelle: "Stylo", PrixVente: "300" }]);
  });

  it("renvoie un tableau vide pour un contenu vide", () => {
    expect(analyserCsv("")).toEqual([]);
    expect(analyserCsv("   \n  ")).toEqual([]);
  });
});

describe("construireCsv (8.2 : export de catalogue)", () => {
  it("construit un CSV avec en-têtes et lignes, séparé par CRLF", () => {
    const csv = construireCsv(["Libelle", "PrixVente"], [
      ["Télécommande", 2500],
      ["Câble HDMI", 1500],
    ]);
    expect(csv).toBe("Libelle,PrixVente\r\nTélécommande,2500\r\nCâble HDMI,1500");
  });

  it("met entre guillemets les champs contenant une virgule, un guillemet ou un saut de ligne", () => {
    const csv = construireCsv(["Libelle"], [['Décodeur, modèle "G11"']]);
    expect(csv).toBe('Libelle\r\n"Décodeur, modèle ""G11"""');
  });

  it("round-trip : analyserCsv(construireCsv(x)) restitue les mêmes valeurs", () => {
    const entetes = ["Libelle", "Categorie"];
    const donnees: (string | number)[][] = [
      ["Décodeur, modèle G11", 'catégorie "premium"'],
      ["Câble HDMI", ""],
    ];
    const rondTrip = analyserCsv(construireCsv(entetes, donnees));
    expect(rondTrip).toEqual([
      { Libelle: "Décodeur, modèle G11", Categorie: 'catégorie "premium"' },
      { Libelle: "Câble HDMI", Categorie: "" },
    ]);
  });
});
