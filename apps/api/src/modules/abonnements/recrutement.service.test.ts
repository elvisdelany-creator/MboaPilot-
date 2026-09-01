import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { recruterAbonne } from "./recrutement.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let familleCanalPlus: number;
let familleDstv: number;
let formuleToutCanalPlus: number;
let formuleDstvCompaq: number;
let kitGlobalZ: number;
let kitDstvCompaq: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;

  familleCanalPlus = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  familleDstv = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get().idFamille;

  const evasion = db
    .insert(schema.formule)
    .values({ idFamille: familleCanalPlus, libelle: "EVASION", prix: 10500, rang: 2 })
    .returning()
    .get();
  formuleToutCanalPlus = db
    .insert(schema.formule)
    .values({ idFamille: familleCanalPlus, libelle: "TOUT CANAL+", prix: 28000, rang: 4 })
    .returning()
    .get().idFormule;
  const compaq = db
    .insert(schema.formule)
    .values({ idFamille: familleDstv, libelle: "COMPAQ", prix: 13000, rang: 3 })
    .returning()
    .get();
  formuleDstvCompaq = compaq.idFormule;

  kitGlobalZ = db
    .insert(schema.kit)
    .values({
      idFamille: familleCanalPlus,
      libelle: "KIT CANAL+ GLOBALZ",
      reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE",
      prixParaboleAccessoires: 0,
    })
    .returning()
    .get().idKit;
  db.insert(schema.kitPrixDecodeur).values({ idKit: kitGlobalZ, idFormule: evasion.idFormule, prixDecodeur: 5000 }).run();
  db.insert(schema.kitPrixDecodeur).values({ idKit: kitGlobalZ, idFormule: formuleToutCanalPlus, prixDecodeur: 1000 }).run();

  kitDstvCompaq = db
    .insert(schema.kit)
    .values({
      idFamille: familleDstv,
      libelle: "KIT DSTV COMPAQ",
      reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL",
      prixKitReference: 55000,
      idFormuleReference: compaq.idFormule,
    })
    .returning()
    .get().idKit;
});

describe("recruterAbonne (7.1)", () => {
  it("recrutement CANAL+ avec kit, payé comptant -> abonnement ACTIF, facture VALIDEE, commission en cours", () => {
    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: formuleToutCanalPlus,
      idKit: kitGlobalZ,
      montantEncaisse: 57000, // 28000 (formule) + 29000 (kit : 1000 + 0 + 28000)
      montantCommissionCanalplus: 5000,
    });

    expect(resultat.statutFacture).toBe("VALIDEE");

    const abonnement = db
      .select()
      .from(schema.abonnement)
      .where(eq(schema.abonnement.numeroAbonnement, resultat.numeroAbonnement))
      .get();
    expect(abonnement?.statut).toBe("ACTIF");
    expect(abonnement?.dateDebut).toBe("2025-11-16");
    expect(abonnement?.dateFin).toBe("2025-12-15");

    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, resultat.idFacture)).get();
    expect(facture?.statut).toBe("VALIDEE");
    expect(facture?.montantTotal).toBe(57000);

    const lignes = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, resultat.idFacture)).all();
    expect(lignes).toHaveLength(2);
    expect(lignes.some((l) => l.idKit === kitGlobalZ && l.prixApplique === 29000)).toBe(true);
    expect(lignes.some((l) => l.numeroAbonnement === resultat.numeroAbonnement && l.prixApplique === 28000)).toBe(true);

    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, resultat.idFacture)).all();
    expect(paiements).toHaveLength(1);
    expect(paiements[0].montant).toBe(57000);

    const suivis = db
      .select()
      .from(schema.suiviCommissionCanalplus)
      .where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, resultat.numeroAbonnement))
      .all();
    expect(suivis).toHaveLength(1);
    expect(suivis[0].statut).toBe("EN_COURS");
    expect(suivis[0].montantCommission).toBe(5000);
    // 6.2 : période probatoire de 4 mois (119 jours) à partir du recrutement
    expect(suivis[0].dateFinProbatoire).toBe("2026-03-15");
  });

  it("sans encaissement, la facture reste BROUILLON et aucun suivi de commission n'est créé", () => {
    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: formuleToutCanalPlus,
      montantEncaisse: 0,
    });

    expect(resultat.statutFacture).toBe("BROUILLON");
    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, resultat.idFacture)).all();
    expect(paiements).toHaveLength(0);
    const suivis = db
      .select()
      .from(schema.suiviCommissionCanalplus)
      .where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, resultat.numeroAbonnement))
      .all();
    expect(suivis).toHaveLength(0);
  });

  it("recrutement DStv avec kit différentiel, payé -> pas de suivi de commission CANAL+", () => {
    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Mballa", prenom: "Sylvie", telephone: "691111111" },
      idFormule: formuleDstvCompaq,
      idKit: kitDstvCompaq,
      montantEncaisse: 68000, // 13000 (formule COMPAQ) + 55000 (kit, base COMPAQ = pas de différentiel)
    });

    expect(resultat.statutFacture).toBe("VALIDEE");
    const suivis = db
      .select()
      .from(schema.suiviCommissionCanalplus)
      .where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, resultat.numeroAbonnement))
      .all();
    expect(suivis).toHaveLength(0);
  });

  it("recrutement pour un abonné déjà existant : aucune nouvelle fiche abonné créée", () => {
    const abonneExistant = db
      .insert(schema.abonne)
      .values({ siteId, nom: "Existant", prenom: "Client", telephone: "699999999" })
      .returning()
      .get();

    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { idAbonne: abonneExistant.idAbonne },
      idFormule: formuleDstvCompaq,
      montantEncaisse: 13000,
    });

    const abonnement = db
      .select()
      .from(schema.abonnement)
      .where(eq(schema.abonnement.numeroAbonnement, resultat.numeroAbonnement))
      .get();
    expect(abonnement?.idAbonne).toBe(abonneExistant.idAbonne);

    const tousLesAbonnes = db.select().from(schema.abonne).all();
    expect(tousLesAbonnes).toHaveLength(1);
  });
});
