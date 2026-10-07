import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import {
  modifierEntreprise,
  trouverDelaiGraceReabonnementEntreprise,
  trouverDureeConservationDonneesEntreprise,
  trouverTauxGarantieEntreprise,
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

  // 6.2, 8.8 : même garde-fou que côté apporteur (apporteur.repository.ts) —
  // un taux vendeur par défaut négatif produirait une commission CANAL+
  // négative (montant_commission = round(montantTotal * taux / 1000)),
  // absurde pour un pour-mille de commission.
  it("rejette un taux de commission vendeur par défaut négatif", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { tauxCommissionVendeurDefaut: -1 })).toThrow(/commission/);
  });

  // 6.1 : un taux de TVA <= -100 % rend le calcul de taxe mathématiquement
  // impossible (division par zéro ou négative dans extraireTaxeDuTTC,
  // packages/shared/src/taxe.ts) — constaté en test grandeur nature : -100 %
  // saisi via l'écran Paramètres a été accepté et a produit un montant_taxe
  // NULL sur une vraie facture, sans aucune erreur.
  it("rejette un taux de TVA négatif", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { tauxTva: -1 })).toThrow(/TVA/);
    expect(() => modifierEntreprise(db, ent.idEntreprise, { tauxTva: -10000 })).toThrow(/TVA/);
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

// 11.3 : "Une durée de conservation définie et paramétrable, avec archivage
// ou anonymisation au-delà" — utilisée par le job quotidien pour
// l'anonymisation automatique des abonnés inactifs
describe("modifierEntreprise — durée de conservation des données (11.3, 8.8)", () => {
  it("la durée par défaut est de 1095 jours (3 ans)", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(trouverDureeConservationDonneesEntreprise(db)).toBe(1095);
    expect(trouverInfosEntrepriseParSite(db, db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite)?.entreprise.dureeConservationDonneesJours).toBe(1095);
  });

  it("définit une durée personnalisée", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    const modifiee = modifierEntreprise(db, ent.idEntreprise, { dureeConservationDonneesJours: 730 });

    expect(modifiee?.dureeConservationDonneesJours).toBe(730);
    expect(trouverDureeConservationDonneesEntreprise(db)).toBe(730);
  });

  it("rejette une durée inférieure à 1 jour", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { dureeConservationDonneesJours: 0 })).toThrow(/au moins 1 jour/);
  });

  it("renvoie 1095 jours par défaut quand aucune entreprise n'existe", () => {
    expect(trouverDureeConservationDonneesEntreprise(db)).toBe(1095);
  });
});

describe("modifierEntreprise — délai de grâce de réabonnement (4.3, 8.8)", () => {
  it("le délai par défaut est de 0 jour (comportement MVP inchangé)", () => {
    db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(trouverDelaiGraceReabonnementEntreprise(db)).toBe(0);
  });

  it("définit un délai de grâce personnalisé", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    const modifiee = modifierEntreprise(db, ent.idEntreprise, { delaiGraceReabonnementJours: 5 });

    expect(modifiee?.delaiGraceReabonnementJours).toBe(5);
    expect(trouverDelaiGraceReabonnementEntreprise(db)).toBe(5);
  });

  it("rejette un délai négatif", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { delaiGraceReabonnementJours: -1 })).toThrow(/négatif/);
  });

  it("renvoie 0 jour par défaut quand aucune entreprise n'existe", () => {
    expect(trouverDelaiGraceReabonnementEntreprise(db)).toBe(0);
  });
});

describe("modifierEntreprise — taux de garantie (5.10, 7.3, 8.8)", () => {
  it("le taux par défaut est de 0 % (gratuit, comportement MVP inchangé)", () => {
    db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(trouverTauxGarantieEntreprise(db)).toBe(0);
  });

  it("définit un taux de garantie personnalisé (tarif réduit)", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    const modifiee = modifierEntreprise(db, ent.idEntreprise, { tauxGarantiePourcent: 50 });

    expect(modifiee?.tauxGarantiePourcent).toBe(50);
    expect(trouverTauxGarantieEntreprise(db)).toBe(50);
  });

  it("rejette un taux hors de la plage 0-100", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { tauxGarantiePourcent: -1 })).toThrow(/0 et 100/);
    expect(() => modifierEntreprise(db, ent.idEntreprise, { tauxGarantiePourcent: 101 })).toThrow(/0 et 100/);
  });

  it("renvoie 0 % par défaut quand aucune entreprise n'existe", () => {
    expect(trouverTauxGarantieEntreprise(db)).toBe(0);
  });
});

// 8.8 : constaté par fuzz de types sur PATCH /entreprise — « abc », décimaux et
// 1e30 étaient stockés dans le paramétrage (taxes, jalons, durées, politique de
// mot de passe, garantie) ; une longueur minimale « abc » cassait ensuite la
// création de tout compte, une garantie « abc » les factures SAV.
describe("modifierEntreprise : valeurs de paramétrage invalides (8.8)", () => {
  const CHAMPS_ENTIERS = [
    "tauxTva",
    "tauxCommissionVendeurDefaut",
    "jalonAlerteUrgent",
    "jalonAlerteModere",
    "jalonAlerteAnticipe",
    "dureeRetentionExpiresJours",
    "dureeConservationDonneesJours",
    "politiqueMdpLongueurMin",
    "delaiGraceReabonnementJours",
    "tauxGarantiePourcent",
  ];
  const CHAMPS_BOOLEENS = ["politiqueMdpExigerMajuscule", "politiqueMdpExigerChiffre", "politiqueMdpExigerCaractereSpecial"];

  function entreprise() {
    return db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  }

  it.each(CHAMPS_ENTIERS.flatMap((champ) => ["abc", 1.5, Number.NaN, 1e30].map((valeur) => [champ, valeur] as const)))(
    "refuse %s = %s sans modifier le paramétrage",
    (champ, valeur) => {
      const ent = entreprise();
      expect(() => modifierEntreprise(db, ent.idEntreprise, { [champ]: valeur } as never)).toThrow();
      expect(db.select().from(schema.entreprise).get()).toEqual(ent);
    }
  );

  it.each(["jalonAlerteUrgent", "jalonAlerteModere", "jalonAlerteAnticipe", "dureeRetentionExpiresJours", "dureeConservationDonneesJours", "politiqueMdpLongueurMin", "delaiGraceReabonnementJours", "tauxGarantiePourcent"])(
    "refuse %s = null (colonne obligatoire)",
    (champ) => {
      const ent = entreprise();
      expect(() => modifierEntreprise(db, ent.idEntreprise, { [champ]: null } as never)).toThrow();
      expect(db.select().from(schema.entreprise).get()).toEqual(ent);
    }
  );

  it.each(CHAMPS_BOOLEENS.flatMap((champ) => ["oui", 1].map((valeur) => [champ, valeur] as const)))("refuse %s = %s (un booléen est attendu)", (champ, valeur) => {
    const ent = entreprise();
    expect(() => modifierEntreprise(db, ent.idEntreprise, { [champ]: valeur } as never)).toThrow(/vrai ou faux/i);
    expect(db.select().from(schema.entreprise).get()).toEqual(ent);
  });

  it.each([123, { x: 1 }])("refuse des mentions légales qui ne sont pas un texte : %s", (valeur) => {
    const ent = entreprise();
    expect(() => modifierEntreprise(db, ent.idEntreprise, { mentionsLegales: valeur as never })).toThrow(/mentions légales/i);
  });

  it("refuse un taux de TVA supérieur à 100 % et une commission supérieure à 1000 pour-mille", () => {
    const ent = entreprise();
    expect(() => modifierEntreprise(db, ent.idEntreprise, { tauxTva: 10001 })).toThrow(/TVA/);
    expect(() => modifierEntreprise(db, ent.idEntreprise, { tauxCommissionVendeurDefaut: 1001 })).toThrow(/commission/i);
  });

  it("accepte des valeurs valides, dont null pour la TVA et la commission (non renseignées)", () => {
    const ent = entreprise();
    const modifiee = modifierEntreprise(db, ent.idEntreprise, { tauxTva: null, tauxCommissionVendeurDefaut: null, jalonAlerteUrgent: 2, jalonAlerteModere: 4, jalonAlerteAnticipe: 10, tauxGarantiePourcent: 80 });
    expect(modifiee).toMatchObject({ tauxTva: null, tauxCommissionVendeurDefaut: null, jalonAlerteUrgent: 2, tauxGarantiePourcent: 80 });
  });
});

// 11.5 : un changement de taux de TVA, de garantie, de jalons ou de politique de mot de
// passe modifie des montants et des droits — il doit laisser une trace immuable
// (auteur, horodatage, valeur avant/après), comme les autres actions sensibles.
describe("journal d'audit du paramétrage entreprise (11.5)", () => {
  it("journalise uniquement les champs réellement modifiés, avec l'auteur", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test", tauxTva: 1925, tauxGarantiePourcent: 50 }).returning().get();
    const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();
    const acteur = db.insert(schema.utilisateur).values({ siteId: site.idSite, nom: "A", prenom: "B", identifiant: "acteur", motDePasseHash: "h", role: "ADMINISTRATEUR" }).returning().get().idUser;

    modifierEntreprise(db, ent.idEntreprise, { tauxTva: 1800, tauxGarantiePourcent: 50, mentionsLegales: "RC/1" }, acteur);

    const lignes = db.select().from(schema.journalAudit).all().filter((j) => j.tableCible === "entreprise");
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ action: "MODIFICATION", utilisateurId: acteur, idCible: String(ent.idEntreprise) });
    expect(JSON.parse(lignes[0].valeurAvant!)).toEqual({ tauxTva: 1925, mentionsLegales: null });
    expect(JSON.parse(lignes[0].valeurApres!)).toEqual({ tauxTva: 1800, mentionsLegales: "RC/1" });
  });

  it("ne journalise rien quand les valeurs envoyées sont identiques aux valeurs actuelles", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test", tauxTva: 1925 }).returning().get();

    modifierEntreprise(db, ent.idEntreprise, { tauxTva: 1925 }, null);

    expect(db.select().from(schema.journalAudit).all().filter((j) => j.tableCible === "entreprise")).toHaveLength(0);
  });

  it("ne journalise pas une modification refusée par la validation", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();

    expect(() => modifierEntreprise(db, ent.idEntreprise, { tauxTva: "abc" as never }, null)).toThrow();

    expect(db.select().from(schema.journalAudit).all()).toHaveLength(0);
  });
});
