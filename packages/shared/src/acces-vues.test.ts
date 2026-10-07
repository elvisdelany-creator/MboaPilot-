import { describe, expect, it } from "vitest";
import { peutAccederVue, vuesAccessibles, type RoleUtilisateur, type VueApplication } from "./acces-vues.js";

// 2.5.1 : matrice des rôles — l'interface ne propose que les écrans que l'API
// autorise (mêmes rôles que les gardes exigerRole de apps/api/src/app.ts).
// Constaté en test grandeur nature : un Comptable voyait l'écran de Caisse entier
// (« Valider et encaisser ») et recevait des toasts « Rôle non autorisé » à
// l'ouverture ; un Technicien SAV voyait la Caisse de la même façon.
describe("peutAccederVue (2.5.1)", () => {
  const ATTENDU: Record<RoleUtilisateur, VueApplication[]> = {
    ADMINISTRATEUR: ["dashboard", "caisse", "sav", "clients", "apporteurs", "stock", "administration"],
    GERANT: ["dashboard", "caisse", "sav", "clients", "apporteurs", "stock", "administration"],
    CAISSIER: ["dashboard", "caisse", "sav", "clients"],
    TECHNICIEN_SAV: ["dashboard", "sav"],
    COMPTABLE: ["dashboard", "clients"],
    APPORTEUR: [],
  };

  for (const [role, vues] of Object.entries(ATTENDU) as [RoleUtilisateur, VueApplication[]][]) {
    it(`${role} accède exactement à : ${vues.join(", ") || "aucun écran (fiche apporteur dédiée)"}`, () => {
      expect(vuesAccessibles(role)).toEqual(vues);
    });
  }

  it("refuse la Caisse au Comptable et au Technicien SAV", () => {
    expect(peutAccederVue("COMPTABLE", "caisse")).toBe(false);
    expect(peutAccederVue("TECHNICIEN_SAV", "caisse")).toBe(false);
  });

  it("refuse le SAV au Comptable", () => {
    expect(peutAccederVue("COMPTABLE", "sav")).toBe(false);
  });

  it("un rôle inconnu n'accède à rien", () => {
    expect(peutAccederVue("PIRATE" as never, "dashboard")).toBe(false);
    expect(vuesAccessibles("PIRATE" as never)).toEqual([]);
  });
});
