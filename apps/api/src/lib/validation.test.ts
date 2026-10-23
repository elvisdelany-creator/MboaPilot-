import { describe, expect, it } from "vitest";
import { verifierTotalAttendu } from "./validation.js";

describe("verifierTotalAttendu : le total affiché à la caisse est celui que le serveur facture", () => {
  it("accepte un total identique, et l'absence de total attendu (clients qui ne l'envoient pas)", () => {
    expect(() => verifierTotalAttendu(2500, 2500)).not.toThrow();
    expect(() => verifierTotalAttendu(2500, undefined)).not.toThrow();
    expect(() => verifierTotalAttendu(2500, null)).not.toThrow();
  });

  it("refuse un total différent, avec un message qui dit quoi faire et les deux montants", () => {
    expect(() => verifierTotalAttendu(2500, 2000)).toThrow(/prix a changé.*2\s?500.*2\s?000.*recharg/is);
  });

  it("refuse un total attendu qui n'est pas un nombre", () => {
    expect(() => verifierTotalAttendu(2500, "2500")).toThrow(/total attendu/i);
    expect(() => verifierTotalAttendu(2500, {})).toThrow(/total attendu/i);
  });
});
