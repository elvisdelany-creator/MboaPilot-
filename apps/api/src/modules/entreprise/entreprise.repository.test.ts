import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { modifierEntreprise, trouverInfosEntrepriseParSite, trouverTauxCommissionVendeurParSite } from "./entreprise.repository.js";
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

  it("le taux de TVA et les mentions légales sont absents par défaut (aucune obligation présumée)", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();

    const infos = trouverInfosEntrepriseParSite(db, site.idSite);

    expect(infos?.entreprise.tauxTva).toBeNull();
    expect(infos?.entreprise.mentionsLegales).toBeNull();
  });
});

describe("modifierEntreprise (6.1, 8.8)", () => {
  it("définit le taux de TVA et les mentions légales", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    const modifiee = modifierEntreprise(db, ent.idEntreprise, { tauxTva: 1925, mentionsLegales: "RC/DLA/2024/B/1234 — NIU M012345678901" });

    expect(modifiee?.tauxTva).toBe(1925);
    expect(modifiee?.mentionsLegales).toBe("RC/DLA/2024/B/1234 — NIU M012345678901");
  });

  it("renvoie undefined pour une entreprise inconnue", () => {
    expect(modifierEntreprise(db, 999999, { tauxTva: 1925 })).toBeUndefined();
  });

  it("définit le taux de commission vendeur par défaut", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    const modifiee = modifierEntreprise(db, ent.idEntreprise, { tauxCommissionVendeurDefaut: 100 });

    expect(modifiee?.tauxCommissionVendeurDefaut).toBe(100);
  });
});

describe("trouverTauxCommissionVendeurParSite (6.2, 8.8)", () => {
  it("renvoie le taux configuré pour le site", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();
    modifierEntreprise(db, ent.idEntreprise, { tauxCommissionVendeurDefaut: 100 });

    expect(trouverTauxCommissionVendeurParSite(db, site.idSite)).toBe(100);
  });

  it("renvoie null si aucun taux n'est configuré", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();

    expect(trouverTauxCommissionVendeurParSite(db, site.idSite)).toBeNull();
  });

  it("renvoie null pour un site inconnu", () => {
    expect(trouverTauxCommissionVendeurParSite(db, 999999)).toBeNull();
  });
});
