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
});

describe("trouverSite (8.7)", () => {
  it("renvoie undefined pour un site inconnu", () => {
    expect(trouverSite(db, 999999)).toBeUndefined();
  });
});
