import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { trouverInfosEntrepriseParSite } from "./entreprise.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;

beforeEach(() => {
  db = creerDbTest();
});

describe("trouverInfosEntrepriseParSite (6.7)", () => {
  it("renvoie l'entreprise et le site pour l'en-tête des documents commerciaux", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test", devise: "XAF" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A", adresse: "Douala" }).returning().get();

    const infos = trouverInfosEntrepriseParSite(db, site.idSite);

    expect(infos?.entreprise.nom).toBe("Boutique Test");
    expect(infos?.entreprise.devise).toBe("XAF");
    expect(infos?.site.nom).toBe("Site A");
    expect(infos?.site.adresse).toBe("Douala");
  });

  it("renvoie undefined pour un site inconnu", () => {
    expect(trouverInfosEntrepriseParSite(db, 999999)).toBeUndefined();
  });
});
