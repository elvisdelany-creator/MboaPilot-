import { describe, expect, it } from "vitest";
import { peutTransitionnerPaiementMobile } from "./statut-paiement-mobile.js";

describe("peutTransitionnerPaiementMobile (6.6 : cycle de vie d'une transaction Orange Money)", () => {
  it("autorise INITIEE -> EN_ATTENTE (soumission à l'API)", () => {
    expect(peutTransitionnerPaiementMobile("INITIEE", "EN_ATTENTE")).toBe(true);
  });

  it("autorise EN_ATTENTE -> REUSSIE, ECHOUEE ou EXPIREE", () => {
    expect(peutTransitionnerPaiementMobile("EN_ATTENTE", "REUSSIE")).toBe(true);
    expect(peutTransitionnerPaiementMobile("EN_ATTENTE", "ECHOUEE")).toBe(true);
    expect(peutTransitionnerPaiementMobile("EN_ATTENTE", "EXPIREE")).toBe(true);
  });

  it("autorise INITIEE -> ECHOUEE (rejet immédiat par l'API)", () => {
    expect(peutTransitionnerPaiementMobile("INITIEE", "ECHOUEE")).toBe(true);
  });

  it("rejette toute transition depuis un état terminal", () => {
    expect(peutTransitionnerPaiementMobile("REUSSIE", "ECHOUEE")).toBe(false);
    expect(peutTransitionnerPaiementMobile("ECHOUEE", "REUSSIE")).toBe(false);
    expect(peutTransitionnerPaiementMobile("EXPIREE", "EN_ATTENTE")).toBe(false);
  });

  it("rejette de sauter directement de INITIEE à REUSSIE", () => {
    expect(peutTransitionnerPaiementMobile("INITIEE", "REUSSIE")).toBe(false);
  });
});
