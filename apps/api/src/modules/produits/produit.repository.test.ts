import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { listerProduits } from "./produit.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let autreSiteId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
});

describe("listerProduits (5.2, 7.3 : catalogue matériel/pièces détachées)", () => {
  it("renvoie les produits du site, cloisonnés", () => {
    db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Décodeur GLOBALZ", prixVente: 15000 }).run();
    db.insert(schema.produit).values({ siteId: autreSiteId, type: "BIEN", libelle: "Autre", prixVente: 5000 }).run();

    const produits = listerProduits(db, siteId);

    expect(produits).toHaveLength(1);
    expect(produits[0].libelle).toBe("Décodeur GLOBALZ");
  });
});
