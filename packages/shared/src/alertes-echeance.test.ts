import { describe, it, expect } from "vitest";
import { classerUrgenceEcheance, detecterJalonAlerte, joursAvantEcheance, JALONS_PAR_DEFAUT } from "./alertes-echeance.js";

describe("detecterJalonAlerte (4.4, 8.8 : jalons par défaut J-7/J-3/J-1)", () => {
  const dateFin = "2025-12-15";

  it("détecte le jalon le plus anticipé (7 jours par défaut)", () => {
    expect(detecterJalonAlerte(dateFin, "2025-12-08")).toEqual({ jours: 7, rang: 3 });
  });

  it("détecte le jalon modéré (3 jours par défaut)", () => {
    expect(detecterJalonAlerte(dateFin, "2025-12-12")).toEqual({ jours: 3, rang: 2 });
  });

  it("détecte le jalon urgent (1 jour par défaut)", () => {
    expect(detecterJalonAlerte(dateFin, "2025-12-14")).toEqual({ jours: 1, rang: 1 });
  });

  it("ne détecte aucun jalon en dehors des seuils configurés", () => {
    expect(detecterJalonAlerte(dateFin, "2025-12-10")).toBeNull();
  });

  it("ne détecte aucun jalon le jour même de l'échéance", () => {
    expect(detecterJalonAlerte(dateFin, "2025-12-15")).toBeNull();
  });

  it("8.8 : les jalons sont paramétrables — un site peut configurer J-10/J-5/J-2", () => {
    const jalonsPersonnalises = { urgent: 2, modere: 5, anticipe: 10 };

    expect(detecterJalonAlerte(dateFin, "2025-12-05", jalonsPersonnalises)).toEqual({ jours: 10, rang: 3 });
    expect(detecterJalonAlerte(dateFin, "2025-12-10", jalonsPersonnalises)).toEqual({ jours: 5, rang: 2 });
    expect(detecterJalonAlerte(dateFin, "2025-12-13", jalonsPersonnalises)).toEqual({ jours: 2, rang: 1 });
    // les anciens seuils par défaut (7/3/1) ne déclenchent plus rien avec cette configuration
    expect(detecterJalonAlerte(dateFin, "2025-12-08", jalonsPersonnalises)).toBeNull();
  });
});

describe("classerUrgenceEcheance (9.3 : liste vivante du tableau de bord)", () => {
  it("classe dans la bande la plus urgente que le nombre de jours restants ne dépasse pas", () => {
    expect(classerUrgenceEcheance(0, JALONS_PAR_DEFAUT)).toEqual({ jours: 1, rang: 1 });
    expect(classerUrgenceEcheance(1, JALONS_PAR_DEFAUT)).toEqual({ jours: 1, rang: 1 });
    expect(classerUrgenceEcheance(2, JALONS_PAR_DEFAUT)).toEqual({ jours: 3, rang: 2 });
    expect(classerUrgenceEcheance(3, JALONS_PAR_DEFAUT)).toEqual({ jours: 3, rang: 2 });
    expect(classerUrgenceEcheance(5, JALONS_PAR_DEFAUT)).toEqual({ jours: 7, rang: 3 });
    expect(classerUrgenceEcheance(7, JALONS_PAR_DEFAUT)).toEqual({ jours: 7, rang: 3 });
  });

  it("renvoie null au-delà du jalon le plus anticipé", () => {
    expect(classerUrgenceEcheance(8, JALONS_PAR_DEFAUT)).toBeNull();
  });

  it("respecte des jalons personnalisés", () => {
    const jalonsPersonnalises = { urgent: 2, modere: 5, anticipe: 10 };
    expect(classerUrgenceEcheance(4, jalonsPersonnalises)).toEqual({ jours: 5, rang: 2 });
    expect(classerUrgenceEcheance(11, jalonsPersonnalises)).toBeNull();
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
