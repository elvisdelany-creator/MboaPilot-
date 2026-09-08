import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import {
  modifierEntreprise,
  trouverDureeRetentionExpiresParSite,
  trouverInfosEntrepriseParSite,
  trouverJalonsAlerteParSite,
  trouverPolitiqueMotDePasseParSite,
  trouverTauxCommissionVendeurParSite,
} from "./entreprise.repository.js";
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

// 4.4, 8.8 : durée de rétention des abonnements EXPIRE dans la liste dédiée
// du tableau de bord (campagnes de reconquête), paramétrable, 90 jours par défaut
describe("modifierEntreprise — durée de rétention des abonnements expirés (4.4, 8.8)", () => {
  it("la durée par défaut est de 90 jours", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const infos = trouverInfosEntrepriseParSite(db, db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite);
    expect(infos?.entreprise.dureeRetentionExpiresJours).toBe(90);
  });

  it("définit une durée personnalisée", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    const modifiee = modifierEntreprise(db, ent.idEntreprise, { dureeRetentionExpiresJours: 120 });

    expect(modifiee?.dureeRetentionExpiresJours).toBe(120);
  });

  it("rejette une durée inférieure à 1 jour", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { dureeRetentionExpiresJours: 0 })).toThrow(/au moins 1 jour/);
  });
});

describe("trouverDureeRetentionExpiresParSite (4.4, 8.8)", () => {
  it("renvoie 90 jours par défaut quand rien n'est configuré", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();

    expect(trouverDureeRetentionExpiresParSite(db, site.idSite)).toBe(90);
  });

  it("renvoie la durée personnalisée configurée pour l'entreprise du site", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();
    modifierEntreprise(db, ent.idEntreprise, { dureeRetentionExpiresJours: 30 });

    expect(trouverDureeRetentionExpiresParSite(db, site.idSite)).toBe(30);
  });

  it("renvoie 90 jours par défaut pour un site inconnu", () => {
    expect(trouverDureeRetentionExpiresParSite(db, 999999)).toBe(90);
  });
});

describe("modifierEntreprise — jalons d'alerte (4.4, 8.8)", () => {
  it("définit des jalons personnalisés valides (anticipe > modere > urgent)", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    const modifiee = modifierEntreprise(db, ent.idEntreprise, { jalonAlerteUrgent: 2, jalonAlerteModere: 5, jalonAlerteAnticipe: 10 });

    expect(modifiee?.jalonAlerteUrgent).toBe(2);
    expect(modifiee?.jalonAlerteModere).toBe(5);
    expect(modifiee?.jalonAlerteAnticipe).toBe(10);
  });

  it("rejette des jalons non strictement croissants (urgent >= modere)", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { jalonAlerteUrgent: 5, jalonAlerteModere: 5, jalonAlerteAnticipe: 10 })).toThrow();
  });

  it("rejette des jalons non strictement croissants (modere >= anticipe)", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { jalonAlerteUrgent: 1, jalonAlerteModere: 10, jalonAlerteAnticipe: 5 })).toThrow();
  });

  it("rejette un jalon inférieur à 1 jour", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { jalonAlerteUrgent: 0, jalonAlerteModere: 3, jalonAlerteAnticipe: 7 })).toThrow();
  });

  it("valide la combinaison résultante même si un seul jalon est modifié à la fois", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    // par défaut : urgent=1, modere=3, anticipe=7 — passer modere à 8 casserait modere < anticipe
    expect(() => modifierEntreprise(db, ent.idEntreprise, { jalonAlerteModere: 8 })).toThrow();
  });
});

describe("trouverJalonsAlerteParSite (4.4, 8.8)", () => {
  it("renvoie les jalons par défaut (7/3/1) quand rien n'est configuré", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();

    expect(trouverJalonsAlerteParSite(db, site.idSite)).toEqual({ urgent: 1, modere: 3, anticipe: 7 });
  });

  it("renvoie les jalons personnalisés configurés pour l'entreprise du site", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();
    modifierEntreprise(db, ent.idEntreprise, { jalonAlerteUrgent: 2, jalonAlerteModere: 5, jalonAlerteAnticipe: 10 });

    expect(trouverJalonsAlerteParSite(db, site.idSite)).toEqual({ urgent: 2, modere: 5, anticipe: 10 });
  });

  it("renvoie les jalons par défaut pour un site inconnu", () => {
    expect(trouverJalonsAlerteParSite(db, 999999)).toEqual({ urgent: 1, modere: 3, anticipe: 7 });
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

// 11.2 : "politique de complexité minimale configurable" du mot de passe
describe("modifierEntreprise — politique de complexité du mot de passe (11.2, 8.8)", () => {
  it("la politique par défaut n'exige que 8 caractères", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();

    expect(trouverPolitiqueMotDePasseParSite(db, site.idSite)).toEqual({
      longueurMin: 8,
      exigerMajuscule: false,
      exigerChiffre: false,
      exigerCaractereSpecial: false,
    });
  });

  it("définit une politique personnalisée", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();

    modifierEntreprise(db, ent.idEntreprise, {
      politiqueMdpLongueurMin: 12,
      politiqueMdpExigerMajuscule: true,
      politiqueMdpExigerChiffre: true,
      politiqueMdpExigerCaractereSpecial: true,
    });

    expect(trouverPolitiqueMotDePasseParSite(db, site.idSite)).toEqual({
      longueurMin: 12,
      exigerMajuscule: true,
      exigerChiffre: true,
      exigerCaractereSpecial: true,
    });
  });

  it("rejette une longueur minimale inférieure à 1 caractère", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { politiqueMdpLongueurMin: 0 })).toThrow(/au moins 1 caractère/);
  });

  it("renvoie la politique par défaut pour un site inconnu", () => {
    expect(trouverPolitiqueMotDePasseParSite(db, 999999)).toEqual({
      longueurMin: 8,
      exigerMajuscule: false,
      exigerChiffre: false,
      exigerCaractereSpecial: false,
    });
  });
});
