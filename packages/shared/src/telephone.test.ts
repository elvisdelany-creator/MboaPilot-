import { describe, it, expect } from "vitest";
import { MESSAGE_FORME_TELEPHONE, telephoneValide, memeTelephone } from "./telephone.js";

// La règle du téléphone (6 à 15 chiffres) n'était connue que de l'API : au comptoir, un numéro « abcdef »
// n'était refusé qu'à la fin de la vente, après la saisie du paiement. Elle est partagée pour que le
// formulaire de nouveau client la vérifie pendant la saisie.
describe("telephoneValide", () => {
  it.each(["690000000", "+237 690 00 00 00", "(237) 690-00-00-00", "690.00.00.00", "  690000000  ", "123456", "1".repeat(15)])("accepte « %s »", (telephone) => {
    expect(telephoneValide(telephone)).toBe(true);
  });

  it.each(["", "   ", "abcdef", "12345", "1".repeat(16), "677;123456", "690 00 00 0a", "6".repeat(5000), "+++", "----------"])("refuse « %s »", (telephone) => {
    expect(telephoneValide(telephone)).toBe(false);
  });

  it("expose un message de règle lisible", () => {
    expect(MESSAGE_FORME_TELEPHONE).toMatch(/6 à 15 chiffres/);
  });
});

// 7.1 : « si le client existe déjà (recherche par téléphone…), sa fiche existante est sélectionnée » — deux saisies d'un même numéro ne se
// ressemblent pas toujours : indicatif, espaces, points.
describe("memeTelephone", () => {
  it.each([
    ["677123456", "677123456"],
    ["677123456", "+237 677 12 34 56"],
    ["677123456", "(237) 677-12-34-56"],
    ["677.12.34.56", "00237677123456"],
    ["  677123456  ", "677 123 456"],
  ])("reconnaît « %s » et « %s » comme le même numéro", (a, b) => {
    expect(memeTelephone(a, b)).toBe(true);
  });

  it.each([
    ["677123456", "677123457"],
    ["677123456", "690123456"],
    ["677123456", ""],
    ["", ""],
    ["abc", "abc"],
  ])("distingue « %s » et « %s »", (a, b) => {
    expect(memeTelephone(a, b)).toBe(false);
  });

  it("ne confond pas deux numéros qui ne partagent que leurs derniers chiffres quand ils sont plus courts", () => {
    expect(memeTelephone("123456", "9123456")).toBe(false);
  });
});
