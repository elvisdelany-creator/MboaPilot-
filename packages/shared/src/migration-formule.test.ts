import { describe, expect, it } from "vitest";
import { validerMigrationFormule } from "./migration-formule.js";

const ACCESS = { idFormule: 1, idFamille: 10, rang: 1, prix: 5000 };
const EVASION = { idFormule: 2, idFamille: 10, rang: 2, prix: 10500 };
const TOUT_CANALPLUS = { idFormule: 3, idFamille: 10, rang: 4, prix: 28000 };
const DSTV_COMPAQ = { idFormule: 4, idFamille: 20, rang: 3, prix: 13000 };

describe("validerMigrationFormule (7.4)", () => {
  it("autorise une formule de rang strictement supérieur et calcule le différentiel", () => {
    const resultat = validerMigrationFormule(ACCESS, EVASION);
    expect(resultat).toEqual({ autorise: true, montantDifferentiel: 5500 });
  });

  it("autorise en sautant plusieurs rangs (Access -> Tout Canal+)", () => {
    const resultat = validerMigrationFormule(ACCESS, TOUT_CANALPLUS);
    expect(resultat).toEqual({ autorise: true, montantDifferentiel: 23000 });
  });

  it("rejette une formule strictement identique (c'est un réabonnement, pas une migration)", () => {
    const resultat = validerMigrationFormule(ACCESS, ACCESS);
    expect(resultat.autorise).toBe(false);
  });

  it("rejette une formule de rang inférieur (rétrogradation) en cours de période", () => {
    const resultat = validerMigrationFormule(EVASION, ACCESS);
    expect(resultat.autorise).toBe(false);
  });

  it("rejette une formule de rang égal issue d'une autre famille", () => {
    const resultat = validerMigrationFormule(EVASION, DSTV_COMPAQ);
    expect(resultat.autorise).toBe(false);
  });
});
