import { describe, it, expect } from "vitest";
import { normaliserLibelle } from "./normaliser-libelle.js";

describe("normaliserLibelle (5.2, 8.2)", () => {
  it("ignore la casse, les accents et les espaces superflus pour rapprocher deux libellés équivalents", () => {
    expect(normaliserLibelle("Télécommande")).toBe(normaliserLibelle("Telecommande"));
    expect(normaliserLibelle("Télécommande")).toBe(normaliserLibelle("TÉLÉCOMMANDE"));
    expect(normaliserLibelle("Télécommande")).toBe(normaliserLibelle("  télécommande  "));
  });

  it("distingue deux libellés réellement différents", () => {
    expect(normaliserLibelle("Télécommande")).not.toBe(normaliserLibelle("Décodeur"));
  });
});
