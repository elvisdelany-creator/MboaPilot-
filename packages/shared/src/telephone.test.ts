import { describe, it, expect } from "vitest";
import { MESSAGE_FORME_TELEPHONE, telephoneValide } from "./telephone.js";

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
