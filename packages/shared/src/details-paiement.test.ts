import { describe, it, expect } from "vitest";
import { erreurDetailsPaiement } from "./details-paiement.js";

const AUJOURDHUI = "2026-11-17";
const cheque = { mode: "CHEQUE" as const, banque: "Afriland First Bank", numeroCheque: "0012345", titulaireCheque: "Paul Nga", dateCheque: "2026-11-17" };
const virement = { mode: "VIREMENT" as const, banque: "Orange Money", referenceVirement: "OM123456" };

describe("erreurDetailsPaiement : chèque", () => {
  it("accepte un chèque complet", () => {
    expect(erreurDetailsPaiement(cheque, AUJOURDHUI)).toBeNull();
  });

  it.each([
    ["la banque", { banque: undefined }],
    ["la banque (espaces)", { banque: "   " }],
    ["le numéro", { numeroCheque: undefined }],
    ["le numéro (vide)", { numeroCheque: "" }],
    ["le titulaire", { titulaireCheque: undefined }],
    ["la date", { dateCheque: undefined }],
  ])("refuse un chèque sans %s", (_nom, manque) => {
    expect(erreurDetailsPaiement({ ...cheque, ...manque }, AUJOURDHUI)).not.toBeNull();
  });

  it("le message dit ce qui manque, pour que la caissière sache quoi corriger", () => {
    expect(erreurDetailsPaiement({ ...cheque, numeroCheque: undefined }, AUJOURDHUI)).toMatch(/numéro/i);
    expect(erreurDetailsPaiement({ ...cheque, banque: undefined }, AUJOURDHUI)).toMatch(/banque/i);
    expect(erreurDetailsPaiement({ ...cheque, titulaireCheque: undefined }, AUJOURDHUI)).toMatch(/titulaire/i);
    expect(erreurDetailsPaiement({ ...cheque, dateCheque: undefined }, AUJOURDHUI)).toMatch(/date/i);
  });

  it.each(["pas une date", "17/11/2026", "2026-13-01", "2026-02-30", "2026-11-17T10:00:00Z", "1999-12-31", "2027-12-31"])("refuse la date %j", (dateCheque) => {
    expect(erreurDetailsPaiement({ ...cheque, dateCheque }, AUJOURDHUI)).toMatch(/date/i);
  });

  it.each(["2026-11-17", "2026-11-10", "2026-02-28", "2027-11-17"])("accepte la date %s (un chèque postdaté d'un an au plus reste courant)", (dateCheque) => {
    expect(erreurDetailsPaiement({ ...cheque, dateCheque }, AUJOURDHUI)).toBeNull();
  });

  it("refuse un texte démesuré : banque, numéro, titulaire", () => {
    expect(erreurDetailsPaiement({ ...cheque, banque: "B".repeat(101) }, AUJOURDHUI)).toMatch(/banque/i);
    expect(erreurDetailsPaiement({ ...cheque, numeroCheque: "1".repeat(51) }, AUJOURDHUI)).toMatch(/numéro/i);
    expect(erreurDetailsPaiement({ ...cheque, titulaireCheque: "T".repeat(101) }, AUJOURDHUI)).toMatch(/titulaire/i);
  });

  it("refuse une valeur qui n'est pas du texte (requête fabriquée à la main)", () => {
    expect(erreurDetailsPaiement({ ...cheque, numeroCheque: 12345 as unknown as string }, AUJOURDHUI)).not.toBeNull();
    expect(erreurDetailsPaiement({ ...cheque, banque: { x: 1 } as unknown as string }, AUJOURDHUI)).not.toBeNull();
  });
});

describe("erreurDetailsPaiement : virement", () => {
  it("accepte un virement avec sa banque et sa référence", () => {
    expect(erreurDetailsPaiement(virement, AUJOURDHUI)).toBeNull();
  });

  it.each([
    ["la banque", { banque: undefined }],
    ["la référence", { referenceVirement: undefined }],
    ["la référence (espaces)", { referenceVirement: "  " }],
  ])("refuse un virement sans %s", (_nom, manque) => {
    expect(erreurDetailsPaiement({ ...virement, ...manque }, AUJOURDHUI)).not.toBeNull();
  });

  it("le message dit ce qui manque", () => {
    expect(erreurDetailsPaiement({ ...virement, referenceVirement: undefined }, AUJOURDHUI)).toMatch(/référence/i);
    expect(erreurDetailsPaiement({ ...virement, banque: undefined }, AUJOURDHUI)).toMatch(/banque/i);
  });

  it("refuse un texte démesuré", () => {
    expect(erreurDetailsPaiement({ ...virement, referenceVirement: "R".repeat(101) }, AUJOURDHUI)).toMatch(/référence/i);
    expect(erreurDetailsPaiement({ ...virement, banque: "B".repeat(101) }, AUJOURDHUI)).toMatch(/banque/i);
  });
});

describe("erreurDetailsPaiement : les autres modes", () => {
  it.each(["CASH", "MOBILE_MONEY"] as const)("%s n'a aucun détail à fournir", (mode) => {
    expect(erreurDetailsPaiement({ mode }, AUJOURDHUI)).toBeNull();
  });
});
