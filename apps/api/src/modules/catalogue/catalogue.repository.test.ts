import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { listerCatalogue } from "./catalogue.repository.js";
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
