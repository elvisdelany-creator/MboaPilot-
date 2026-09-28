import { describe, it, expect } from "vitest";
import { excedentEncaissementSuspect, SEUIL_EXCEDENT_ENCAISSEMENT_SUSPECT } from "./excedent-encaissement.js";

describe("excedentEncaissementSuspect (8.5, 9.2 : rendu de monnaie sans garde-fou de saisie)", () => {
  it("n'alerte pas sur un rendu de monnaie usuel (quelques billets d'écart)", () => {
    expect(excedentEncaissementSuspect(10000, 2500)).toBe(false);
  });

  it("n'alerte pas sur un encaissement exact ou partiel", () => {
    expect(excedentEncaissementSuspect(2500, 2500)).toBe(false);
    expect(excedentEncaissementSuspect(1000, 2500)).toBe(false);
  });

  it("alerte au-delà du seuil configuré, quelle que soit l'ampleur du total", () => {
    expect(excedentEncaissementSuspect(2500 + SEUIL_EXCEDENT_ENCAISSEMENT_SUSPECT + 1, 2500)).toBe(true);
    expect(excedentEncaissementSuspect(2500 + SEUIL_EXCEDENT_ENCAISSEMENT_SUSPECT, 2500)).toBe(false);
  });

  it("attrape une saisie erronée de plusieurs ordres de grandeur (chiffre en trop)", () => {
    expect(excedentEncaissementSuspect(22002200, 2200)).toBe(true);
  });
});
