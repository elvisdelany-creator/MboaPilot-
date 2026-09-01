import { describe, it, expect } from "vitest";
import { peutTransitionnerSav } from "./statut-sav.js";

describe("peutTransitionnerSav (5.10)", () => {
  it("autorise la progression normale du cycle", () => {
    expect(peutTransitionnerSav("RECU", "DIAGNOSTIC")).toBe(true);
    expect(peutTransitionnerSav("DIAGNOSTIC", "DEVIS_ATTENTE")).toBe(true);
    expect(peutTransitionnerSav("DEVIS_ATTENTE", "REPARATION")).toBe(true);
    expect(peutTransitionnerSav("REPARATION", "PRET")).toBe(true);
    expect(peutTransitionnerSav("PRET", "LIVRE")).toBe(true);
  });

  it("autorise de sauter le devis quand il n'est pas nécessaire", () => {
    expect(peutTransitionnerSav("DIAGNOSTIC", "REPARATION")).toBe(true);
  });

  it("autorise IRREPARABLE ou ABANDONNE depuis RECU, DIAGNOSTIC, DEVIS_ATTENTE ou REPARATION", () => {
    expect(peutTransitionnerSav("RECU", "IRREPARABLE")).toBe(true);
    expect(peutTransitionnerSav("DIAGNOSTIC", "ABANDONNE")).toBe(true);
    expect(peutTransitionnerSav("DEVIS_ATTENTE", "ABANDONNE")).toBe(true);
    expect(peutTransitionnerSav("REPARATION", "IRREPARABLE")).toBe(true);
  });

  it("rejette un retour en arrière", () => {
    expect(peutTransitionnerSav("REPARATION", "DIAGNOSTIC")).toBe(false);
    expect(peutTransitionnerSav("PRET", "REPARATION")).toBe(false);
  });

  it("rejette toute transition depuis un état terminal (LIVRE, IRREPARABLE, ABANDONNE)", () => {
    expect(peutTransitionnerSav("LIVRE", "PRET")).toBe(false);
    expect(peutTransitionnerSav("IRREPARABLE", "REPARATION")).toBe(false);
    expect(peutTransitionnerSav("ABANDONNE", "DIAGNOSTIC")).toBe(false);
  });

  it("rejette de sauter directement à PRET ou LIVRE sans passer par la réparation", () => {
    expect(peutTransitionnerSav("RECU", "PRET")).toBe(false);
    expect(peutTransitionnerSav("RECU", "LIVRE")).toBe(false);
  });

  it("rejette IRREPARABLE/ABANDONNE une fois la réparation prête", () => {
    expect(peutTransitionnerSav("PRET", "IRREPARABLE")).toBe(false);
  });
});
