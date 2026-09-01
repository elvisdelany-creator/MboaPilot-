import { describe, it, expect } from "vitest";
import { detecterJalonAlerte, joursAvantEcheance } from "./alertes-echeance.js";

describe("detecterJalonAlerte (4.4)", () => {
  const dateFin = "2025-12-15";

  it("détecte J-7", () => {
    expect(detecterJalonAlerte(dateFin, "2025-12-08")).toBe("J-7");
  });

  it("détecte J-3", () => {
    expect(detecterJalonAlerte(dateFin, "2025-12-12")).toBe("J-3");
  });

  it("détecte J-1", () => {
    expect(detecterJalonAlerte(dateFin, "2025-12-14")).toBe("J-1");
  });

  it("ne détecte aucun jalon en dehors de J-7/J-3/J-1", () => {
    expect(detecterJalonAlerte(dateFin, "2025-12-10")).toBeNull();
  });

  it("ne détecte aucun jalon le jour même de l'échéance", () => {
    expect(detecterJalonAlerte(dateFin, "2025-12-15")).toBeNull();
  });
});

// 9.3 : liste vivante des abonnements à échéance sur le tableau de bord,
// distincte du journal d'alertes (4.4) — utile même hors des jalons exacts.
describe("joursAvantEcheance", () => {
  it("calcule le nombre de jours restants avant la date de fin", () => {
    expect(joursAvantEcheance("2025-12-15", "2025-12-10")).toBe(5);
  });

  it("renvoie 0 le jour même de l'échéance", () => {
    expect(joursAvantEcheance("2025-12-15", "2025-12-15")).toBe(0);
  });

  it("renvoie un nombre négatif pour une échéance déjà dépassée", () => {
    expect(joursAvantEcheance("2025-12-15", "2025-12-17")).toBe(-2);
  });
});
