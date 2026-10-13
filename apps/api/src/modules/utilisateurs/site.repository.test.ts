import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerSite, listerSites, modifierSite, trouverSite } from "./site.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let idEntreprise: number;

beforeEach(() => {
  db = creerDbTest();
  idEntreprise = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get().idEntreprise;
});

describe("creerSite (8.7)", () => {
  it("crée un site rattaché à l'entreprise", () => {
    const site = creerSite(db, { idEntreprise, nom: "Site Bonamoussadi", adresse: "Douala" });

    expect(site.idEntreprise).toBe(idEntreprise);
    expect(site.nom).toBe("Site Bonamoussadi");
    expect(site.actif).toBe(1);
  });

  it("exige un nom", () => {
    expect(() => creerSite(db, { idEntreprise, nom: "  " })).toThrow(/nom/i);
  });
});

describe("listerSites (8.7)", () => {
  it("liste uniquement les sites de l'entreprise donnée", () => {
    creerSite(db, { idEntreprise, nom: "Site A" });
    const autreEntreprise = db.insert(schema.entreprise).values({ nom: "Autre entreprise" }).returning().get().idEntreprise;
    creerSite(db, { idEntreprise: autreEntreprise, nom: "Site B" });

    const liste = listerSites(db, idEntreprise);

    expect(liste).toHaveLength(1);
    expect(liste[0].nom).toBe("Site A");
  });
});

describe("modifierSite (8.7)", () => {
  it("modifie les coordonnées et peut désactiver un site", () => {
    const site = creerSite(db, { idEntreprise, nom: "Site A" });

    const modifie = modifierSite(db, site.idSite, { adresse: "Nouvelle adresse", actif: false });

    expect(modifie?.adresse).toBe("Nouvelle adresse");
    expect(modifie?.actif).toBe(0);
  });

  it("renvoie undefined pour un site inconnu", () => {
    expect(modifierSite(db, 999999, { nom: "X" })).toBeUndefined();
  });

  // 8.7 : même garde-fou qu'à la création (creerSite) — constaté en test
  // grandeur nature via un appel API direct : un nom vide/blanc était
  // accepté sans erreur, effaçant le nom affiché partout (en-tête, reçus,
  // sélecteurs de site).
  it("rejette un nom vide ou blanc", () => {
    const site = creerSite(db, { idEntreprise, nom: "Site A" });

    expect(() => modifierSite(db, site.idSite, { nom: "" })).toThrow(/nom/i);
    expect(() => modifierSite(db, site.idSite, { nom: "   " })).toThrow(/nom/i);
  });
});

// 11.4, 6.7 : "Compatibilité imprimante thermique 80mm (protocole ESC/POS)"
describe("modifierSite — imprimante réseau (11.4, 6.7)", () => {
  it("configure l'hôte et le port de l'imprimante réseau du site", () => {
    const site = creerSite(db, { idEntreprise, nom: "Site A" });

    const modifie = modifierSite(db, site.idSite, { imprimanteHote: "192.168.1.50", imprimantePort: 9100 });

    expect(modifie?.imprimanteHote).toBe("192.168.1.50");
    expect(modifie?.imprimantePort).toBe(9100);
  });

  it("aucune imprimante configurée par défaut", () => {
    const site = creerSite(db, { idEntreprise, nom: "Site A" });

    expect(site.imprimanteHote).toBeNull();
    expect(site.imprimantePort).toBeNull();
  });

  it("efface la configuration en passant une chaîne vide", () => {
    const site = creerSite(db, { idEntreprise, nom: "Site A" });
    modifierSite(db, site.idSite, { imprimanteHote: "192.168.1.50", imprimantePort: 9100 });

    const efface = modifierSite(db, site.idSite, { imprimanteHote: "" });

    expect(efface?.imprimanteHote).toBeNull();
    expect(efface?.imprimantePort).toBeNull();
  });
});

describe("trouverSite (8.7)", () => {
  it("renvoie undefined pour un site inconnu", () => {
    expect(trouverSite(db, 999999)).toBeUndefined();
  });
});

// 11.4 : constaté par fuzz de types — le port d'imprimante « abc » ou décimal
// était stocké tel quel, et l'impression tentait ensuite de s'y connecter.
describe("modifierSite : imprimante invalide (11.4)", () => {
  it.each(["abc", 1.5, Number.NaN, 0, 70000, -1, null])("refuse le port d'imprimante %s sans modifier le site", (port) => {
    const site = creerSite(db, { idEntreprise, nom: "Site A" });

    expect(() => modifierSite(db, site.idSite, { imprimanteHote: "192.168.1.50", imprimantePort: port as never })).toThrow(/port/i);
    expect(trouverSite(db, site.idSite)).toMatchObject({ imprimanteHote: null, imprimantePort: null });
  });

  it("accepte un port valide", () => {
    const site = creerSite(db, { idEntreprise, nom: "Site A" });
    expect(modifierSite(db, site.idSite, { imprimanteHote: "192.168.1.50", imprimantePort: 9100 })?.imprimantePort).toBe(9100);
  });

  it.each([123, { x: 1 }])("refuse un hôte d'imprimante qui n'est pas un texte : %s", (hote) => {
    const site = creerSite(db, { idEntreprise, nom: "Site A" });
    expect(() => modifierSite(db, site.idSite, { imprimanteHote: hote as never })).toThrow(/hôte/i);
  });

  it("refuse un « actif » qui n'est pas un booléen", () => {
    const site = creerSite(db, { idEntreprise, nom: "Site A" });
    expect(() => modifierSite(db, site.idSite, { actif: "non" as never })).toThrow(/actif/i);
  });
});

// Constaté en test grandeur nature : un site acceptait un nom de 100 000 caractères, une adresse
// de 100 000 caractères et un second « Site principal » (en-tête, reçus et sélecteurs ne
// distinguent plus les boutiques).
describe("site : nom et adresse (8.7)", () => {
  it("retire les espaces autour du nom et de l'adresse", () => {
    const site = creerSite(db, { idEntreprise, nom: "  Boutique Akwa ", adresse: " Rue des Écoles " });

    expect(site).toMatchObject({ nom: "Boutique Akwa", adresse: "Rue des Écoles" });
  });

  it.each([
    ["un nom de plus de 100 caractères", { nom: "N".repeat(101) }, /nom.*100 caractères/i],
    ["une adresse de plus de 300 caractères", { adresse: "A".repeat(301) }, /adresse.*300 caractères/i],
  ])("refuse à la création %s", (_libelle, surcharge, message) => {
    expect(() => creerSite(db, { idEntreprise, nom: "Site", ...surcharge })).toThrow(message);
  });

  it("refuse un second site de même nom dans l'entreprise, à la casse et aux espaces près, désactivé ou non", () => {
    const premier = creerSite(db, { idEntreprise, nom: "Site principal" });
    modifierSite(db, premier.idSite, { actif: false });

    for (const homonyme of ["Site principal", "  site  PRINCIPAL "]) {
      expect(() => creerSite(db, { idEntreprise, nom: homonyme }), homonyme).toThrow(/site porte déjà ce nom/i);
    }
    expect(listerSites(db, idEntreprise)).toHaveLength(1);
  });

  it("refuse à la modification un nom déjà pris par un autre site, mais pas son propre nom", () => {
    const a = creerSite(db, { idEntreprise, nom: "Site A" });
    creerSite(db, { idEntreprise, nom: "Site B" });

    expect(() => modifierSite(db, a.idSite, { nom: "site b" })).toThrow(/site porte déjà ce nom/i);
    expect(modifierSite(db, a.idSite, { nom: "Site A", adresse: "Douala" })?.adresse).toBe("Douala");
  });

  it("refuse à la modification un nom ou une adresse trop longs", () => {
    const site = creerSite(db, { idEntreprise, nom: "Site A" });

    expect(() => modifierSite(db, site.idSite, { nom: "N".repeat(101) })).toThrow(/nom.*100 caractères/i);
    expect(() => modifierSite(db, site.idSite, { adresse: "A".repeat(301) })).toThrow(/adresse.*300 caractères/i);
    expect(trouverSite(db, site.idSite)?.nom).toBe("Site A");
  });
});
