import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerApporteur, listerApporteurs, modifierApporteur, trouverApporteur } from "./apporteur.repository.js";

let db: Db;

beforeEach(() => {
  db = creerDbTest();
});

describe("creerApporteur / trouverApporteur / listerApporteurs (6.3)", () => {
  it("crée un apporteur actif par défaut", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur", telephone: "690000000", tauxCommissionDefaut: 500 });

    expect(apporteur.actif).toBe(1);
    expect(trouverApporteur(db, apporteur.idApporteur)?.nom).toBe("Jean Apporteur");
    expect(listerApporteurs(db)).toHaveLength(1);
  });
});

describe("modifierApporteur", () => {
  it("permet de désactiver un apporteur et de changer son taux", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur" });

    modifierApporteur(db, apporteur.idApporteur, { actif: false, tauxCommissionDefaut: 1000 });

    const misAJour = trouverApporteur(db, apporteur.idApporteur);
    expect(misAJour?.actif).toBe(0);
    expect(misAJour?.tauxCommissionDefaut).toBe(1000);
  });
});
