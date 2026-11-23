import { describe, it, expect } from "vitest";
import { normaliserLibelle } from "./normaliser-libelle.js";

describe("normaliserLibelle (5.2, 8.2)", () => {
  it("ignore la casse, les accents et les espaces superflus pour rapprocher deux libellés équivalents", () => {
    expect(normaliserLibelle("Télécommande")).toBe(normaliserLibelle("Telecommande"));
    expect(normaliserLibelle("Télécommande")).toBe(normaliserLibelle("TÉLÉCOMMANDE"));
    expect(normaliserLibelle("Télécommande")).toBe(normaliserLibelle("  télécommande  "));
  });

  // un tableur français met une espace insécable entre les mots, une ressaisie une espace en double : même article
  it("ignore aussi les espaces internes multiples ou insécables, et les tabulations", () => {
    const nbsp = String.fromCharCode(0xa0);
    const fine = String.fromCharCode(0x202f);
    const tab = String.fromCharCode(9);
    const reference = normaliserLibelle("Écran Plat");
    expect(normaliserLibelle("Écran  Plat")).toBe(reference);
    expect(normaliserLibelle(`Écran${nbsp}Plat`)).toBe(reference);
    expect(normaliserLibelle(`Écran${fine}Plat`)).toBe(reference);
    expect(normaliserLibelle(`Écran${tab}Plat`)).toBe(reference);
    expect(normaliserLibelle(`  ÉCRAN ${nbsp} ${tab} plat  `)).toBe(reference);
    expect(reference).toBe("ecran plat");
  });

  it("ne confond pas deux mots collés avec deux mots séparés", () => {
    expect(normaliserLibelle("EcranPlat")).not.toBe(normaliserLibelle("Ecran Plat"));
  });

  it("distingue deux libellés réellement différents", () => {
    expect(normaliserLibelle("Télécommande")).not.toBe(normaliserLibelle("Décodeur"));
  });
});
