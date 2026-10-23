import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { calculerDateFin, calculerPrixKit, calculerPrixKitHorsFormule, type Kit } from "@mboapilot/shared";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { chargerCatalogueDepart, listerOperateursDepart } from "./catalogue-depart.js";
import { creerFamille, creerFormule, listerCatalogue, listerOptions, modifierFormule } from "./catalogue.repository.js";

let db: Db;
let idUser: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  idUser = db.insert(schema.utilisateur).values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" }).returning().get().idUser;
});

function famille(libelle: string) {
  return db.select().from(schema.familleAbonnement).where(eq(schema.familleAbonnement.libelle, libelle)).get();
}
function formule(libelleFamille: string, libelle: string) {
  const f = famille(libelleFamille)!;
  return db.select().from(schema.formule).where(and(eq(schema.formule.idFamille, f.idFamille), eq(schema.formule.libelle, libelle))).get();
}
function kit(libelle: string) {
  return db.select().from(schema.kit).where(eq(schema.kit.libelle, libelle)).get();
}
// le kit tel que le moteur de prix le lit, avec sa grille de décodeurs et sa formule de référence
function kitMoteur(libelle: string): Kit {
  const k = kit(libelle)!;
  if (k.reglePrix === "PRIX_FIXE") return { reglePrix: "PRIX_FIXE", prixFixe: k.prixFixe! };
  if (k.reglePrix === "PRIX_KIT_FIXE_PAR_DIFFERENTIEL") {
    const ref = db.select().from(schema.formule).where(eq(schema.formule.idFormule, k.idFormuleReference!)).get()!;
    return { reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL", prixKitReference: k.prixKitReference!, formuleReference: { idFormule: ref.idFormule, prix: ref.prix } };
  }
  const grille = db.select().from(schema.kitPrixDecodeur).where(eq(schema.kitPrixDecodeur.idKit, k.idKit)).all();
  return { reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", prixParaboleAccessoires: k.prixParaboleAccessoires, prixDecodeurParFormule: Object.fromEntries(grille.map((g) => [g.idFormule, g.prixDecodeur])) };
}

// Annexe 14.1 du cahier des charges : « référence rapide pour la recette et la saisie initiale du catalogue ». Sans catalogue de
// départ, une boutique neuve saisit à la main une trentaine de formules, des kits à règle de prix et des options compatibles.
describe("listerOperateursDepart", () => {
  it("propose les six opérateurs de l'annexe 14.1, avec ce qu'ils contiennent", () => {
    const operateurs = listerOperateursDepart();

    expect(operateurs.map((o) => o.libelle)).toEqual(["CANAL+", "DStv", "StarTimes", "24H Sport", "Moreplex", "Streaming et IPTV"]);
    const canal = operateurs[0];
    expect(canal).toMatchObject({ nombreFormules: 5, nombreKits: 4, nombreOptions: 5 });
    expect(operateurs.every((o) => o.cle && o.nombreFormules > 0)).toBe(true);
  });

  it("signale ce que l'opérateur n'a pas encore communiqué, au lieu de l'inventer", () => {
    const canal = listerOperateursDepart().find((o) => o.libelle === "CANAL+")!;
    const streaming = listerOperateursDepart().find((o) => o.libelle === "Streaming et IPTV")!;

    expect(canal.notes.join(" ")).toMatch(/OTT/);
    expect(streaming.notes.join(" ")).toMatch(/Disney\+/);
  });
});

describe("chargerCatalogueDepart : CANAL+", () => {
  beforeEach(() => {
    chargerCatalogueDepart(db, ["canal-plus"], idUser);
  });

  it("crée les cinq formules aux tarifs de l'annexe 14.1, en cycle strict de 30 jours", () => {
    expect(["ACCESS", "UNA WELCOME", "EVASION", "ACCESS+", "TOUT CANAL+"].map((l) => formule("CANAL+", l)?.prix)).toEqual([5000, 8000, 10500, 15000, 28000]);
    expect(formule("CANAL+", "EVASION")).toMatchObject({ modeDuree: "STRICT_30J", dureeCycles: 1, actif: 1 });
  });

  it("classe les formules par rang croissant de prix, pour que « formule supérieure » ait un sens", () => {
    const rangs = ["ACCESS", "UNA WELCOME", "EVASION", "ACCESS+", "TOUT CANAL+"].map((l) => formule("CANAL+", l)!.rang);

    expect(rangs).toEqual([...rangs].sort((a, b) => a - b));
    expect(new Set(rangs).size).toBe(rangs.length);
  });

  it("crée les kits GlobalZ et Z4 : décodeur 5 000 avec EVASION, 1 000 avec TOUT CANAL+ (kit = 15 500 et 29 000)", () => {
    for (const nom of ["KIT CANAL+ GLOBALZ", "KIT CANAL+ Z4"]) {
      const k = kitMoteur(nom);
      expect(calculerPrixKit(k, { idFormule: formule("CANAL+", "EVASION")!.idFormule, prix: 10500 })).toBe(15500);
      expect(calculerPrixKit(k, { idFormule: formule("CANAL+", "TOUT CANAL+")!.idFormule, prix: 28000 })).toBe(29000);
    }
  });

  it("crée le kit G11 : décodeur 30 000 + parabole 0 + EVASION 10 500 = 40 500", () => {
    const evasion = formule("CANAL+", "EVASION")!;

    expect(calculerPrixKit(kitMoteur("KIT CANAL+ G11"), { idFormule: evasion.idFormule, prix: evasion.prix })).toBe(40500);
  });

  it("ne devine pas les prix que l'annexe ne donne pas : kit sans grille pour les autres formules, kit OTT sans prix", () => {
    const access = formule("CANAL+", "ACCESS")!;

    expect(() => calculerPrixKit(kitMoteur("KIT CANAL+ GLOBALZ"), { idFormule: access.idFormule, prix: access.prix })).toThrow(/non configuré/);
    expect(() => calculerPrixKit(kitMoteur("KIT CANAL+ DÉCODEUR OTT"), { idFormule: access.idFormule, prix: access.prix })).toThrow(/non configuré/);
  });

  it("crée English Plus compatible avec ACCESS et EVASION à 5 000, et à 2 000 sur ACCESS+ (prix de surcharge)", () => {
    const option = listerOptions(db).find((o) => o.libelle === "Option English Plus")!;
    const compat = (l: string) => option.formulesCompatibles.find((c) => c.idFormule === formule("CANAL+", l)!.idFormule);

    expect(option.prix).toBe(5000);
    expect(compat("ACCESS")).toMatchObject({ prixSurcharge: null });
    expect(compat("EVASION")).toMatchObject({ prixSurcharge: null });
    expect(compat("ACCESS+")).toMatchObject({ prixSurcharge: 2000 });
    expect(compat("TOUT CANAL+")).toBeUndefined();
  });

  it("crée Charme et les trois options Netflix sans les rattacher : l'annexe ne dit pas à quelles formules", () => {
    const options = listerOptions(db);

    expect(options.find((o) => o.libelle === "Option Charme")).toMatchObject({ prix: 7000, formulesCompatibles: [] });
    expect(options.filter((o) => /Netflix/.test(o.libelle)).map((o) => [o.prix, o.formulesCompatibles.length])).toEqual([[3000, 0], [4000, 0], [5000, 0]]);
  });
});

describe("chargerCatalogueDepart : autres opérateurs", () => {
  it("DStv : cinq formules et le kit COMPAQ par différentiel (55 000 avec COMPAQ, 70 000 avec PREMIUM)", () => {
    chargerCatalogueDepart(db, ["dstv"], idUser);
    const k = kitMoteur("KIT DSTV COMPAQ");

    expect(["YANGA", "CONFAM", "COMPAQ", "COMPAQ+", "PREMIUM"].map((l) => formule("DSTV", l)?.prix)).toEqual([5000, 9000, 13000, 19000, 28000]);
    expect(calculerPrixKit(k, { idFormule: formule("DSTV", "COMPAQ")!.idFormule, prix: 13000 })).toBe(55000);
    expect(calculerPrixKit(k, { idFormule: formule("DSTV", "PREMIUM")!.idFormule, prix: 28000 })).toBe(70000);
    expect(listerOptions(db).filter((o) => /French|Extra View/.test(o.libelle)).map((o) => o.prix)).toEqual([13000, 6000, 4500]);
  });

  it("StarTimes, 24H Sport et Moreplex : kits à prix fixe indépendants de la formule", () => {
    chargerCatalogueDepart(db, ["startimes", "24h-sport", "moreplex"], idUser);

    expect([kit("KIT STARTIMES")?.prixFixe, kit("KIT 24H SPORT")?.prixFixe, kit("KIT MOREPLEX")?.prixFixe]).toEqual([18000, 30000, 30000]);
    expect(["NOVA", "SMART", "SUPER (EN/FR)", "GLOBAL"].map((l) => formule("StarTimes", l)?.prix)).toEqual([2500, 5000, 9000, 10500]);
    expect(formule("Moreplex", "FULL MOREPLEX")?.prix).toBe(5000);
  });

  it("les kits à prix fixe incluent leur formule : le client paie 18 000 / 30 000 / 30 000 au total, formule comprise", () => {
    chargerCatalogueDepart(db, ["startimes", "24h-sport", "moreplex"], idUser);
    const cas: [string, string, string][] = [["StarTimes", "GLOBAL", "KIT STARTIMES"], ["24H Sport", "FULL 24H SPORT 3 MOIS", "KIT 24H SPORT"], ["Moreplex", "FULL MOREPLEX", "KIT MOREPLEX"]];

    const totaux = cas.map(([fam, form, nomKit]) => {
      const f = formule(fam, form)!;
      return f.prix + calculerPrixKitHorsFormule(kitMoteur(nomKit), { idFormule: f.idFormule, prix: f.prix });
    });

    expect(totaux).toEqual([18000, 30000, 30000]);
    for (const operateur of listerOperateursDepart().filter((o) => ["startimes", "24h-sport", "moreplex"].includes(o.cle))) {
      expect(operateur.notes.join(" ")).toMatch(/inclut sa première formule/);
    }
  });

  it("24H Sport : la formule de 3 mois vaut 3 cycles de 30 jours, donc 90 jours de validité", () => {
    chargerCatalogueDepart(db, ["24h-sport"], idUser);
    const f = formule("24H Sport", "FULL 24H SPORT 3 MOIS")!;

    expect(f).toMatchObject({ prix: 15000, modeDuree: "STRICT_30J", dureeCycles: 3 });
    expect(calculerDateFin("2025-11-16", f.dureeCycles, f.modeDuree)).toBe("2026-02-13"); // début + 89 jours
  });

  it("Streaming : une famille par service, formules 1 mois et 12 mois (12 cycles de 30 jours)", () => {
    chargerCatalogueDepart(db, ["streaming"], idUser);

    expect(["Netflix", "Prime Vidéo", "Crunchyroll"].map((s) => [formule(s, "1 mois")?.prix, formule(s, "12 mois")?.prix])).toEqual([[3500, 26000], [3500, 26000], [3500, 26000]]);
    expect([formule("IPTV", "1 mois")?.prix, formule("IPTV", "12 mois")?.prix]).toEqual([5000, 40000]);
    expect(formule("Netflix", "12 mois")).toMatchObject({ dureeCycles: 12, modeDuree: "STRICT_30J" });
  });

  it("Streaming : Disney+ existe mais désactivé, sans tarif : il ne se vend pas gratuitement avant d'être renseigné", () => {
    chargerCatalogueDepart(db, ["streaming"], idUser);
    const mois = formule("Disney+", "1 mois")!;
    const an = formule("Disney+", "12 mois")!;

    expect([mois.actif, an.actif]).toEqual([0, 0]);
    const vendables = listerCatalogue(db).flatMap((f) => f.formules).filter((f) => f.libelle && f.prix === 0);
    expect(vendables).toEqual([]);
  });
});

describe("chargerCatalogueDepart : sécurité et idempotence", () => {
  it("rapporte ce qui a été créé", () => {
    const resultat = chargerCatalogueDepart(db, ["canal-plus"], idUser);

    expect(resultat.crees).toMatchObject({ familles: 1, formules: 5, kits: 4, options: 5, liaisons: 3 });
    expect(resultat.dejaPresents).toBe(0);
  });

  it("recharger le même opérateur ne crée rien de plus et n'écrase pas les prix modifiés par la boutique", () => {
    chargerCatalogueDepart(db, ["canal-plus"], idUser);
    const evasion = formule("CANAL+", "EVASION")!;
    modifierFormule(db, evasion.idFormule, { prix: 11000 }, idUser);
    const avant = db.select().from(schema.formule).all().length;

    const resultat = chargerCatalogueDepart(db, ["canal-plus"], idUser);

    expect(db.select().from(schema.formule).all()).toHaveLength(avant);
    expect(formule("CANAL+", "EVASION")?.prix).toBe(11000);
    expect(resultat.crees).toMatchObject({ familles: 0, formules: 0, kits: 0, options: 0, liaisons: 0 });
    expect(resultat.dejaPresents).toBeGreaterThan(0);
  });

  it("complète une famille déjà saisie à la main au lieu de la dupliquer ni d'échouer", () => {
    const manuelle = creerFamille(db, { libelle: "canal+" });
    creerFormule(db, { idFamille: manuelle.idFamille, libelle: "EVASION", prix: 9999, rang: 7 }, idUser);

    const resultat = chargerCatalogueDepart(db, ["canal-plus"], idUser);

    expect(db.select().from(schema.familleAbonnement).all().filter((f) => /canal/i.test(f.libelle))).toHaveLength(1);
    expect(formule("canal+", "EVASION")?.prix).toBe(9999); // la saisie de la boutique prime
    expect(formule("canal+", "ACCESS")?.prix).toBe(5000);
    expect(resultat.crees.formules).toBe(4);
  });

  it("refuse un opérateur inconnu, sans rien créer", () => {
    expect(() => chargerCatalogueDepart(db, ["canal-plus", "inconnu"], idUser)).toThrow(/inconnu/i);
    expect(db.select().from(schema.familleAbonnement).all()).toHaveLength(0);
  });

  it("refuse une sélection vide", () => {
    expect(() => chargerCatalogueDepart(db, [], idUser)).toThrow(/au moins un opérateur/i);
  });

  it("journalise les créations au nom de l'acteur", () => {
    chargerCatalogueDepart(db, ["moreplex"], idUser);

    const journal = db.select().from(schema.journalAudit).all();
    expect(journal.length).toBeGreaterThan(0);
    expect(journal.every((e) => e.utilisateurId === idUser)).toBe(true);
  });

  it("charge plusieurs opérateurs d'un coup, tout ou rien", () => {
    const resultat = chargerCatalogueDepart(db, ["canal-plus", "dstv", "startimes", "24h-sport", "moreplex", "streaming"], idUser);

    expect(resultat.crees.formules).toBe(5 + 5 + 4 + 1 + 1 + 10);
    expect(resultat.crees.kits).toBe(4 + 1 + 1 + 1 + 1);
  });
});
