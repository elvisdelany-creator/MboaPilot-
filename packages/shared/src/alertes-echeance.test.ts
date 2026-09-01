import { describe, it, expect } from "vitest";
import { detecterJalonAlerte } from "./alertes-echeance.js";

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
