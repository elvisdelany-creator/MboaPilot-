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

  // 8.2 : Excel en version française (la norme au Cameroun) enregistre et
  // rouvre les CSV avec le point-virgule comme séparateur — un fichier
  // retravaillé dans le tableur ne doit pas être rejeté comme « colonnes
  // manquantes » (constaté en test grandeur nature).
  it("détecte le point-virgule comme séparateur (CSV Excel version française)", () => {
    const lignes = analyserCsv('Type;Libelle;PrixVente\r\nBIEN;Câble HDMI;1500\r\nSERVICE;"Pose; murale";5000');

    expect(lignes).toEqual([
      { Type: "BIEN", Libelle: "Câble HDMI", PrixVente: "1500" },
      { Type: "SERVICE", Libelle: "Pose; murale", PrixVente: "5000" },
    ]);
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

  // 8.2 : constaté en test grandeur nature — un libellé « =HYPERLINK(...) »
  // était exporté tel quel : Excel l'exécute comme une formule à l'ouverture du
  // fichier (injection de formule CSV, OWASP). Les textes commençant par un
  // caractère de formule reçoivent une apostrophe qui force le mode texte.
  it("neutralise les textes qui commencent par un caractère de formule (= + - @ tabulation)", () => {
    const csv = construireCsv(["Libelle"], [["=1+1"], ["+33600000000"], ["-SOMME(A1)"], ["@SUM(A1)"], ["\tcmd"], ["Câble HDMI"]]);
    expect(csv.split("\r\n")).toEqual(["Libelle", "'=1+1", "'+33600000000", "'-SOMME(A1)", "'@SUM(A1)", "'\tcmd", "Câble HDMI"]);
  });

  it("ne modifie pas les nombres, même négatifs", () => {
    expect(construireCsv(["Ecart"], [[-5], [1500]])).toBe("Ecart\r\n-5\r\n1500");
  });

  it("round-trip : un texte neutralisé à l'export est restitué à l'identique à l'import", () => {
    const textes = ["=HYPERLINK(\"http://exemple.test\";\"clic\")", "+33 6 00 00 00 00", "'=déjà apostrophé", "'Cas normal", "@mention"];
    const relu = analyserCsv(construireCsv(["Libelle"], textes.map((t) => [t])));
    expect(relu.map((l) => l.Libelle)).toEqual(textes);
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
