import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import {
  creerFamille,
  creerFormule,
  creerOption,
  delierOptionFormule,
  lierOptionFormule,
  listerCatalogue,
  listerFamilles,
  listerFormules,
  listerOptions,
  modifierFormule,
  modifierOption,
} from "./catalogue.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;

beforeEach(() => {
  db = creerDbTest();
});

describe("listerCatalogue (5.1)", () => {
  it("regroupe les formules et les kits par famille d'abonnement", () => {
    const canalPlus = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    const evasion = db
      .insert(schema.formule)
      .values({ idFamille: canalPlus.idFamille, libelle: "EVASION", prix: 10500, rang: 2 })
      .returning()
      .get();
    db.insert(schema.kit)
      .values({ idFamille: canalPlus.idFamille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" })
      .run();

    const catalogue = listerCatalogue(db);

    expect(catalogue).toHaveLength(1);
    expect(catalogue[0].libelle).toBe("CANAL+");
    expect(catalogue[0].formules).toEqual([
      expect.objectContaining({ idFormule: evasion.idFormule, libelle: "EVASION", prix: 10500 }),
    ]);
    expect(catalogue[0].kits).toHaveLength(1);
    expect(catalogue[0].kits[0].libelle).toBe("KIT CANAL+ GLOBALZ");
  });

  it("enrichit un kit PRIX_DECODEUR_VARIABLE_SELON_FORMULE avec la grille de prix décodeur (5.1.1)", () => {
    const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    const evasion = db
      .insert(schema.formule)
      .values({ idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 })
      .returning()
      .get();
    const k = db
      .insert(schema.kit)
      .values({
        idFamille: fam.idFamille,
        libelle: "KIT CANAL+ GLOBALZ",
        reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE",
        prixParaboleAccessoires: 0,
      })
      .returning()
      .get();
    db.insert(schema.kitPrixDecodeur).values({ idKit: k.idKit, idFormule: evasion.idFormule, prixDecodeur: 5000 }).run();

    const catalogue = listerCatalogue(db);
    const kit = catalogue[0].kits[0];

    expect(kit.reglePrix).toBe("PRIX_DECODEUR_VARIABLE_SELON_FORMULE");
    if (kit.reglePrix === "PRIX_DECODEUR_VARIABLE_SELON_FORMULE") {
      expect(kit.prixDecodeurParFormule[evasion.idFormule]).toBe(5000);
    }
  });

  it("enrichit un kit PRIX_KIT_FIXE_PAR_DIFFERENTIEL avec sa formule de référence (5.1.1)", () => {
    const fam = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get();
    const compaq = db
      .insert(schema.formule)
      .values({ idFamille: fam.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 })
      .returning()
      .get();
    db.insert(schema.kit)
      .values({
        idFamille: fam.idFamille,
        libelle: "KIT DSTV COMPAQ",
        reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL",
        prixKitReference: 55000,
        idFormuleReference: compaq.idFormule,
      })
      .run();

    const catalogue = listerCatalogue(db);
    const kit = catalogue[0].kits[0];

    expect(kit.reglePrix).toBe("PRIX_KIT_FIXE_PAR_DIFFERENTIEL");
    if (kit.reglePrix === "PRIX_KIT_FIXE_PAR_DIFFERENTIEL") {
      expect(kit.formuleReference).toEqual({ idFormule: compaq.idFormule, prix: 13000 });
    }
  });

  it("ne renvoie pas les formules désactivées", () => {
    const fam = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get();
    db.insert(schema.formule).values({ idFamille: fam.idFamille, libelle: "YANGA", prix: 5000, rang: 1, actif: 0 }).run();

    const catalogue = listerCatalogue(db);

    expect(catalogue[0].formules).toHaveLength(0);
  });
});

describe("Back-office catalogue (8.8) : familles, formules, options — sans intervention développeur", () => {
  describe("creerFamille / listerFamilles", () => {
    it("crée une famille et la retrouve dans la liste", () => {
      creerFamille(db, { libelle: "MOREPLEX" });

      const familles = listerFamilles(db);

      expect(familles.map((f) => f.libelle)).toEqual(["MOREPLEX"]);
    });
  });

  describe("creerFormule / modifierFormule", () => {
    it("crée une formule avec son mode de calcul de validité (4.1) et sa durée en cycles", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();

      const formule = creerFormule(db, { idFamille: fam.idFamille, libelle: "ACCESS", prix: 5000, rang: 1, modeDuree: "MOIS_CIVIL", dureeCycles: 2 });

      expect(formule.modeDuree).toBe("MOIS_CIVIL");
      expect(formule.dureeCycles).toBe(2);
      expect(formule.actif).toBe(1);
    });

    it("modifie le prix, le mode de durée et désactive une formule — invisible ensuite du catalogue de vente", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
      const formule = creerFormule(db, { idFamille: fam.idFamille, libelle: "ACCESS", prix: 5000, rang: 1 });

      const modifiee = modifierFormule(db, formule.idFormule, { prix: 5500, modeDuree: "MOIS_CIVIL", actif: false });

      expect(modifiee?.prix).toBe(5500);
      expect(modifiee?.modeDuree).toBe("MOIS_CIVIL");
      expect(modifiee?.actif).toBe(0);
      expect(listerCatalogue(db)[0].formules).toHaveLength(0);
    });

    it("renvoie undefined pour une formule inconnue", () => {
      expect(modifierFormule(db, 999999, { prix: 1000 })).toBeUndefined();
    });
  });

  describe("listerFormules", () => {
    it("liste toutes les formules d'une famille, y compris désactivées (contrairement au catalogue de vente)", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
      creerFormule(db, { idFamille: fam.idFamille, libelle: "ACCESS", prix: 5000, rang: 1 });
      const evasion = creerFormule(db, { idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 });
      modifierFormule(db, evasion.idFormule, { actif: false });

      const formules = listerFormules(db, fam.idFamille);

      expect(formules).toHaveLength(2);
      expect(formules.find((f) => f.idFormule === evasion.idFormule)?.actif).toBe(0);
    });
  });

  describe("creerOption / modifierOption / lierOptionFormule / delierOptionFormule", () => {
    it("crée une option, la lie à une formule avec un prix de surcharge, puis la délie", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
      const formule = creerFormule(db, { idFamille: fam.idFamille, libelle: "ACCESS", prix: 5000, rang: 1 });
      const option = creerOption(db, { libelle: "Bouquet Sport+", prix: 2000 });

      lierOptionFormule(db, { idFormule: formule.idFormule, idOption: option.idOption, prixSurcharge: 2500 });
      const options = listerOptions(db);

      expect(options).toHaveLength(1);
      expect(options[0].formulesCompatibles).toEqual([{ idFormule: formule.idFormule, prixSurcharge: 2500 }]);

      delierOptionFormule(db, formule.idFormule, option.idOption);
      expect(listerOptions(db)[0].formulesCompatibles).toHaveLength(0);
    });

    it("modifie le libellé et le prix d'une option", () => {
      const option = creerOption(db, { libelle: "Bouquet Sport+", prix: 2000 });

      const modifiee = modifierOption(db, option.idOption, { libelle: "Bouquet Sport Premium", prix: 2500 });

      expect(modifiee?.libelle).toBe("Bouquet Sport Premium");
      expect(modifiee?.prix).toBe(2500);
    });
  });
});
