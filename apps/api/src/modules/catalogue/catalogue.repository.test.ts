import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import {
  creerFamille,
  creerFormule,
  creerKit,
  creerOption,
  delierOptionFormule,
  definirComposantKit,
  definirPrixDecodeurKit,
  lierOptionFormule,
  listerCatalogue,
  listerComposantsKit,
  listerFamilles,
  listerFormules,
  listerKits,
  listerOptions,
  modifierFormule,
  modifierKit,
  modifierOption,
  supprimerComposantKit,
  supprimerPrixDecodeurKit,
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

    it("exige un libellé", () => {
      expect(() => creerFamille(db, { libelle: "  " })).toThrow(/libellé/i);
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

    // 7.4 : un prix de formule négatif se propage tel quel dans le
    // différentiel de migration (cible.prix - actuelle.prix), sans aucun
    // garde-fou de ce côté — reproduit une facture de migration à -10 000 FCFA
    it("rejette un prix ou un libellé invalide", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();

      expect(() => creerFormule(db, { idFamille: fam.idFamille, libelle: "ACCESS", prix: -5000, rang: 1 })).toThrow(/négatif|positif/i);
      expect(() => creerFormule(db, { idFamille: fam.idFamille, libelle: "  ", prix: 5000, rang: 1 })).toThrow(/libellé/i);

      const formule = creerFormule(db, { idFamille: fam.idFamille, libelle: "ACCESS", prix: 5000, rang: 1 });
      expect(() => modifierFormule(db, formule.idFormule, { prix: -100 })).toThrow(/négatif|positif/i);
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

    it("rejette un prix négatif ou un libellé vide", () => {
      expect(() => creerOption(db, { libelle: "Bouquet Sport+", prix: -2000 })).toThrow(/négatif|positif/i);
      expect(() => creerOption(db, { libelle: "  ", prix: 2000 })).toThrow(/libellé/i);

      const option = creerOption(db, { libelle: "Bouquet Sport+", prix: 2000 });
      expect(() => modifierOption(db, option.idOption, { prix: -500 })).toThrow(/négatif|positif/i);
    });
  });

  describe("creerKit / modifierKit / listerKits (5.1.1)", () => {
    it("crée un kit à prix fixe et le retrouve dans la liste de sa famille", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "24H SPORT" }).returning().get();

      const kit = creerKit(db, { idFamille: fam.idFamille, libelle: "KIT 24H SPORT", reglePrix: "PRIX_FIXE", prixFixe: 30000 });

      expect(kit.reglePrix).toBe("PRIX_FIXE");
      const kits = listerKits(db, fam.idFamille);
      expect(kits).toHaveLength(1);
      expect(kits[0].prixFixe).toBe(30000);
    });

    it("crée un kit à différentiel par rapport à une formule de référence", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get();
      const compaq = creerFormule(db, { idFamille: fam.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 });

      const kit = creerKit(db, {
        idFamille: fam.idFamille,
        libelle: "KIT DSTV COMPAQ",
        reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL",
        idFormuleReference: compaq.idFormule,
        prixKitReference: 55000,
      });

      expect(kit.idFormuleReference).toBe(compaq.idFormule);
      expect(kit.prixKitReference).toBe(55000);
    });

    it("modifie le libellé et le prix fixe d'un kit", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "MOREPLEX" }).returning().get();
      const kit = creerKit(db, { idFamille: fam.idFamille, libelle: "KIT MOREPLEX", reglePrix: "PRIX_FIXE", prixFixe: 30000 });

      const modifie = modifierKit(db, kit.idKit, { libelle: "KIT MOREPLEX v2", prixFixe: 32000 });

      expect(modifie?.libelle).toBe("KIT MOREPLEX v2");
      expect(modifie?.prixFixe).toBe(32000);
    });

    it("renvoie undefined pour un kit inconnu", () => {
      expect(modifierKit(db, 999999, { prixFixe: 1000 })).toBeUndefined();
    });

    it("rejette un libellé vide ou un prix négatif", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "MOREPLEX" }).returning().get();

      expect(() => creerKit(db, { idFamille: fam.idFamille, libelle: "  ", reglePrix: "PRIX_FIXE", prixFixe: 30000 })).toThrow(/libellé/i);
      expect(() => creerKit(db, { idFamille: fam.idFamille, libelle: "KIT", reglePrix: "PRIX_FIXE", prixFixe: -30000 })).toThrow(/négatif|positif/i);

      const kit = creerKit(db, { idFamille: fam.idFamille, libelle: "KIT MOREPLEX", reglePrix: "PRIX_FIXE", prixFixe: 30000 });
      expect(() => modifierKit(db, kit.idKit, { prixFixe: -100 })).toThrow(/négatif|positif/i);
    });
  });

  describe("definirPrixDecodeurKit / supprimerPrixDecodeurKit (5.1.1)", () => {
    it("définit puis retire un prix décodeur pour une formule, reflété dans le catalogue de vente", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
      const evasion = creerFormule(db, { idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 });
      const kit = creerKit(db, { idFamille: fam.idFamille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" });

      definirPrixDecodeurKit(db, { idKit: kit.idKit, idFormule: evasion.idFormule, prixDecodeur: 5000 });
      const catalogue = listerCatalogue(db);
      const kitVente = catalogue.find((f) => f.idFamille === fam.idFamille)!.kits[0];
      expect(kitVente.reglePrix).toBe("PRIX_DECODEUR_VARIABLE_SELON_FORMULE");
      if (kitVente.reglePrix === "PRIX_DECODEUR_VARIABLE_SELON_FORMULE") {
        expect(kitVente.prixDecodeurParFormule[evasion.idFormule]).toBe(5000);
      }

      // idempotent : redéfinir la même paire met à jour, ne duplique pas
      definirPrixDecodeurKit(db, { idKit: kit.idKit, idFormule: evasion.idFormule, prixDecodeur: 6000 });
      expect(listerKits(db, fam.idFamille)[0]).toBeDefined();

      supprimerPrixDecodeurKit(db, kit.idKit, evasion.idFormule);
      const catalogueApres = listerCatalogue(db);
      const kitApres = catalogueApres.find((f) => f.idFamille === fam.idFamille)!.kits[0];
      if (kitApres.reglePrix === "PRIX_DECODEUR_VARIABLE_SELON_FORMULE") {
        expect(kitApres.prixDecodeurParFormule[evasion.idFormule]).toBeUndefined();
      }
    });

    it("rejette un prix décodeur négatif", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
      const evasion = creerFormule(db, { idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 });
      const kit = creerKit(db, { idFamille: fam.idFamille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" });

      expect(() => definirPrixDecodeurKit(db, { idKit: kit.idKit, idFormule: evasion.idFormule, prixDecodeur: -5000 })).toThrow(/négatif|positif/i);
    });
  });

  describe("definirComposantKit / supprimerComposantKit / listerComposantsKit (5.1, 5.2 : kit \"produit composé\")", () => {
    it("définit puis retire un composant d'un kit, idempotent sur redéfinition", () => {
      const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
      const kit = creerKit(db, { idFamille: fam.idFamille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_FIXE", prixFixe: 15000 });
      const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
      const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
      const decodeur = db
        .insert(schema.produit)
        .values({ siteId, type: "BIEN", libelle: "Décodeur GLOBALZ", prixVente: 15000, suiviStock: 1 })
        .returning()
        .get();

      definirComposantKit(db, { idKit: kit.idKit, idProduit: decodeur.idProduit, quantite: 1 });
      expect(listerComposantsKit(db, kit.idKit)).toEqual([{ idKit: kit.idKit, idProduit: decodeur.idProduit, quantite: 1 }]);

      // idempotent : redéfinir la même paire met à jour la quantité, ne duplique pas
      definirComposantKit(db, { idKit: kit.idKit, idProduit: decodeur.idProduit, quantite: 2 });
      expect(listerComposantsKit(db, kit.idKit)).toEqual([{ idKit: kit.idKit, idProduit: decodeur.idProduit, quantite: 2 }]);

      supprimerComposantKit(db, kit.idKit, decodeur.idProduit);
      expect(listerComposantsKit(db, kit.idKit)).toEqual([]);
    });
  });
});

// 8.8 : constaté par fuzz de types sur l'API en test grandeur nature — seuls les
// montants négatifs étaient refusés : « abc », 1.5 ou 1e30 étaient stockés tels
// quels dans les colonnes entières (prix, rang, durée, quantités), et se
// propageaient dans les calculs de prix des kits et des différentiels.
describe("catalogue : montants et entiers invalides refusés (8.8)", () => {
  const INVALIDES: unknown[] = ["abc", 1.5, Number.NaN, 1e30, { x: 1 }];

  function famille() {
    return creerFamille(db, { libelle: "DSTV" });
  }

  it.each(INVALIDES)("creerFormule refuse un prix %s", (prix) => {
    const f = famille();
    expect(() => creerFormule(db, { idFamille: f.idFamille, libelle: "COMPAQ", prix: prix as never, rang: 1 })).toThrow(/prix de la formule/i);
    expect(listerFormules(db, f.idFamille)).toHaveLength(0);
  });

  it.each(INVALIDES)("creerFormule refuse un rang %s", (rang) => {
    const f = famille();
    expect(() => creerFormule(db, { idFamille: f.idFamille, libelle: "COMPAQ", prix: 1000, rang: rang as never })).toThrow(/rang/i);
  });

  it("creerFormule exige un rang", () => {
    const f = famille();
    expect(() => creerFormule(db, { idFamille: f.idFamille, libelle: "COMPAQ", prix: 1000 } as never)).toThrow(/rang/i);
  });

  it.each(INVALIDES)("creerFormule refuse une durée en cycles %s", (dureeCycles) => {
    const f = famille();
    expect(() => creerFormule(db, { idFamille: f.idFamille, libelle: "COMPAQ", prix: 1000, rang: 1, dureeCycles: dureeCycles as never })).toThrow(/durée/i);
  });

  it("creerFormule refuse une durée en cycles nulle ou négative", () => {
    const f = famille();
    expect(() => creerFormule(db, { idFamille: f.idFamille, libelle: "COMPAQ", prix: 1000, rang: 1, dureeCycles: 0 })).toThrow(/durée/i);
  });

  it.each([["prix"], ["rang"], ["dureeCycles"]])("modifierFormule refuse %s = « abc » sans modifier la formule", (champ) => {
    const f = famille();
    const formule = creerFormule(db, { idFamille: f.idFamille, libelle: "COMPAQ", prix: 1000, rang: 1 });

    expect(() => modifierFormule(db, formule.idFormule, { [champ]: "abc" } as never)).toThrow();
    expect(listerFormules(db, f.idFamille)[0]).toMatchObject({ prix: 1000, rang: 1 });
  });

  it.each(INVALIDES)("creerOption et modifierOption refusent un prix %s", (prix) => {
    expect(() => creerOption(db, { libelle: "English Plus", prix: prix as never })).toThrow(/prix de l'option/i);
    const option = creerOption(db, { libelle: "English Plus", prix: 2000 });
    expect(() => modifierOption(db, option.idOption, { prix: prix as never })).toThrow(/prix de l'option/i);
    expect(listerOptions(db)[0].prix).toBe(2000);
  });

  it.each(["abc", 1.5, -3])("lierOptionFormule refuse un prix de surcharge %s", (prixSurcharge) => {
    const f = famille();
    const formule = creerFormule(db, { idFamille: f.idFamille, libelle: "COMPAQ", prix: 1000, rang: 1 });
    const option = creerOption(db, { libelle: "English Plus", prix: 2000 });

    expect(() => lierOptionFormule(db, { idFormule: formule.idFormule, idOption: option.idOption, prixSurcharge: prixSurcharge as never })).toThrow(/surcharge/i);
    expect(listerOptions(db)[0].formulesCompatibles).toHaveLength(0);
  });

  it.each([["prixFixe"], ["prixParaboleAccessoires"], ["prixKitReference"]])("creerKit et modifierKit refusent %s = « abc » ou décimal", (champ) => {
    const f = famille();
    for (const invalide of ["abc", 1.5]) {
      expect(() => creerKit(db, { idFamille: f.idFamille, libelle: "Kit", reglePrix: "PRIX_FIXE", prixFixe: 5000, [champ]: invalide } as never)).toThrow(/kit|parabole/i);
    }
    const kit = creerKit(db, { idFamille: f.idFamille, libelle: "Kit", reglePrix: "PRIX_FIXE", prixFixe: 5000 });
    expect(() => modifierKit(db, kit.idKit, { [champ]: "abc" } as never)).toThrow(/kit|parabole/i);
    expect(listerKits(db, f.idFamille)[0].prixFixe).toBe(5000);
  });

  it.each(["abc", 1.5])("definirPrixDecodeurKit refuse un prix %s", (prixDecodeur) => {
    const f = famille();
    const formule = creerFormule(db, { idFamille: f.idFamille, libelle: "COMPAQ", prix: 1000, rang: 1 });
    const kit = creerKit(db, { idFamille: f.idFamille, libelle: "Kit", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" });

    expect(() => definirPrixDecodeurKit(db, { idKit: kit.idKit, idFormule: formule.idFormule, prixDecodeur: prixDecodeur as never })).toThrow(/décodeur/i);
  });

  it.each(["abc", 1.5, 0, -2])("definirComposantKit refuse une quantité %s", (quantite) => {
    const f = famille();
    const kit = creerKit(db, { idFamille: f.idFamille, libelle: "Kit", reglePrix: "PRIX_FIXE", prixFixe: 5000 });
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();
    const produit = db.insert(schema.produit).values({ siteId: site.idSite, type: "BIEN", libelle: "Câble", prixVente: 1000 }).returning().get();

    expect(() => definirComposantKit(db, { idKit: kit.idKit, idProduit: produit.idProduit, quantite: quantite as never })).toThrow(/quantité/i);
    expect(listerComposantsKit(db, kit.idKit)).toHaveLength(0);
  });
});
