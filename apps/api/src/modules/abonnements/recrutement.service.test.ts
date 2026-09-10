import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { recruterAbonne } from "./recrutement.service.js";
import { creerApporteur } from "../apporteurs/apporteur.repository.js";
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
    // 6.2, 8.8 : taux vendeur par défaut de l'entreprise, appliqué en l'absence d'apporteur référent
    db.update(schema.entreprise).set({ tauxCommissionVendeurDefaut: 100 }).run(); // 10 %

    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: formuleToutCanalPlus,
      idKit: kitGlobalZ,
      montantEncaisse: 57000, // 28000 (formule) + 29000 (kit : 1000 + 0 + 28000)
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
    expect(suivis[0].montantCommission).toBe(5700); // 10 % de 57000 (montant_total)
    // 6.2 : période probatoire de 4 mois (119 jours) à partir du recrutement
    expect(suivis[0].dateFinProbatoire).toBe("2026-03-15");
  });

  // 6.5 : "Chèque — Banque, numéro de chèque, titulaire, date"
  it("recrutement payé par chèque -> le paiement enregistre le mode et les champs propres au chèque", () => {
    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: formuleToutCanalPlus,
      montantEncaisse: 28000,
      modePaiement: "CHEQUE",
      banque: "Afriland First Bank",
      numeroCheque: "0012345",
      titulaireCheque: "Valentin Nga Ndongo",
      dateCheque: "2025-11-16",
    });

    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, resultat.idFacture)).all();
    expect(paiements).toHaveLength(1);
    expect(paiements[0].mode).toBe("CHEQUE");
    expect(paiements[0].banque).toBe("Afriland First Bank");
    expect(paiements[0].numeroCheque).toBe("0012345");
    expect(paiements[0].titulaireCheque).toBe("Valentin Nga Ndongo");
    expect(paiements[0].dateCheque).toBe("2025-11-16");
  });

  // 6.5 : "Virement bancaire — Banque émettrice, référence de virement"
  it("recrutement payé par virement -> le paiement enregistre le mode et la référence de virement", () => {
    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: formuleToutCanalPlus,
      montantEncaisse: 28000,
      modePaiement: "VIREMENT",
      banque: "Ecobank",
      referenceVirement: "VIR-2025-000512",
    });

    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, resultat.idFacture)).all();
    expect(paiements).toHaveLength(1);
    expect(paiements[0].mode).toBe("VIREMENT");
    expect(paiements[0].banque).toBe("Ecobank");
    expect(paiements[0].referenceVirement).toBe("VIR-2025-000512");
  });

  it("applique le taux de l'apporteur référent plutôt que le taux vendeur par défaut, quand les deux sont configurés", () => {
    db.update(schema.entreprise).set({ tauxCommissionVendeurDefaut: 100 }).run(); // 10 %
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur", tauxCommissionDefaut: 200 }); // 20 %

    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: formuleToutCanalPlus,
      montantEncaisse: 28000,
      apporteurId: apporteur.idApporteur,
    });

    const suivi = db
      .select()
      .from(schema.suiviCommissionCanalplus)
      .where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, resultat.numeroAbonnement))
      .get();
    expect(suivi?.montantCommission).toBe(5600); // 20 % de 28000, pas 10 %
  });

  it("sans aucun taux configuré (ni apporteur, ni vendeur par défaut), la commission est nulle", () => {
    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: formuleToutCanalPlus,
      montantEncaisse: 28000,
    });

    const suivi = db
      .select()
      .from(schema.suiviCommissionCanalplus)
      .where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, resultat.numeroAbonnement))
      .get();
    expect(suivi?.montantCommission).toBe(0);
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

  it("5.1, 5.2 : la vente d'un kit décrémente le stock de ses composants suivis", () => {
    const idDecodeur = db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Décodeur GLOBALZ", prixVente: 15000, suiviStock: 1, quantiteStock: 5 })
      .returning()
      .get().idProduit;
    db.insert(schema.kitComposant).values({ idKit: kitGlobalZ, idProduit: idDecodeur, quantite: 1 }).run();

    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: formuleToutCanalPlus,
      idKit: kitGlobalZ,
      montantEncaisse: 0,
    });

    const decodeur = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idDecodeur)).get();
    expect(decodeur?.quantiteStock).toBe(4);
  });
});

describe("recruterAbonne — apporteur d'affaires (6.3 : lien permanent abonné ↔ apporteur)", () => {
  it("un nouvel abonné recruté pour le compte d'un apporteur reçoit le lien permanent dès la création", () => {
    const apporteur = db.insert(schema.sousDistributeur).values({ nom: "Jean Apporteur" }).returning().get();

    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: formuleDstvCompaq,
      montantEncaisse: 13000,
      apporteurId: apporteur.idApporteur,
    });

    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, resultat.numeroAbonnement)).get();
    const abonne = db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, abonnement!.idAbonne)).get();
    expect(abonne?.apporteurId).toBe(apporteur.idApporteur);
    expect(abonnement?.apporteurId).toBe(apporteur.idApporteur);
  });

  it("un abonné existant déjà lié à un apporteur transmet ce lien à un nouveau recrutement sans le repréciser", () => {
    const apporteur = db.insert(schema.sousDistributeur).values({ nom: "Jean Apporteur" }).returning().get();
    const abonneExistant = db
      .insert(schema.abonne)
      .values({ siteId, nom: "Existant", prenom: "Client", telephone: "699999999", apporteurId: apporteur.idApporteur })
      .returning()
      .get();

    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { idAbonne: abonneExistant.idAbonne },
      idFormule: formuleDstvCompaq,
      montantEncaisse: 13000,
      // pas d'apporteurId fourni : doit être hérité du lien permanent de l'abonné
    });

    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, resultat.numeroAbonnement)).get();
    expect(abonnement?.apporteurId).toBe(apporteur.idApporteur);
  });

  it("un apporteurId fourni pour un abonné existant ne modifie jamais son lien permanent (6.3)", () => {
    const abonneExistant = db
      .insert(schema.abonne)
      .values({ siteId, nom: "Existant", prenom: "Client", telephone: "699999999" })
      .returning()
      .get();
    const apporteur = db.insert(schema.sousDistributeur).values({ nom: "Jean Apporteur" }).returning().get();

    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { idAbonne: abonneExistant.idAbonne },
      idFormule: formuleDstvCompaq,
      montantEncaisse: 13000,
      apporteurId: apporteur.idApporteur,
    });

    const abonne = db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, abonneExistant.idAbonne)).get();
    expect(abonne?.apporteurId).toBeNull();
  });
});

describe("recruterAbonne — compte partagé streaming (5.9)", () => {
  it("affecte l'abonnement à un écran du compte partagé", () => {
    const familleNetflix = db.insert(schema.familleAbonnement).values({ libelle: "NETFLIX" }).returning().get().idFamille;
    const formuleNetflix = db.insert(schema.formule).values({ idFamille: familleNetflix, libelle: "PREMIUM", prix: 3500, rang: 1 }).returning().get().idFormule;
    const compte = db
      .insert(schema.comptePartageStreaming)
      .values({ siteId, idFamille: familleNetflix, libelle: "Compte Netflix #1", nombreEcransMax: 2 })
      .returning()
      .get();

    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
      idFormule: formuleNetflix,
      montantEncaisse: 3500,
      idComptePartage: compte.idComptePartage,
    });

    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, resultat.numeroAbonnement)).get();
    expect(abonnement?.idComptePartage).toBe(compte.idComptePartage);
  });

  it("refuse l'affectation quand le compte partagé est déjà à sa capacité maximale (403 métier)", () => {
    const familleNetflix = db.insert(schema.familleAbonnement).values({ libelle: "NETFLIX" }).returning().get().idFamille;
    const formuleNetflix = db.insert(schema.formule).values({ idFamille: familleNetflix, libelle: "PREMIUM", prix: 3500, rang: 1 }).returning().get().idFormule;
    const compte = db
      .insert(schema.comptePartageStreaming)
      .values({ siteId, idFamille: familleNetflix, libelle: "Compte Netflix #1", nombreEcransMax: 1 })
      .returning()
      .get();
    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Premier", prenom: "Occupant", telephone: "690000001" },
      idFormule: formuleNetflix,
      montantEncaisse: 3500,
      idComptePartage: compte.idComptePartage,
    });

    expect(() =>
      recruterAbonne(db, {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Second", prenom: "Occupant", telephone: "690000002" },
        idFormule: formuleNetflix,
        montantEncaisse: 3500,
        idComptePartage: compte.idComptePartage,
      })
    ).toThrow(/capacité|écran/i);
  });

  it("renvoie une erreur pour un compte partagé inconnu", () => {
    expect(() =>
      recruterAbonne(db, {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
        idFormule: formuleDstvCompaq,
        montantEncaisse: 13000,
        idComptePartage: 999999,
      })
    ).toThrow(/introuvable/i);
  });

  it("6.4, 7.1 : applique une remise ponctuelle sur le prix de la formule", () => {
    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
      idFormule: formuleDstvCompaq,
      montantEncaisse: 12000,
      remise: 1000,
    });

    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, resultat.idFacture)).get();
    expect(facture?.montantTotal).toBe(12000);
    const ligne = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, resultat.idFacture)).all()[0];
    expect(ligne).toMatchObject({ prixApplique: 12000, remise: 1000 });
  });

  it("6.4 : rejette une remise dépassant le prix de la formule", () => {
    expect(() =>
      recruterAbonne(db, {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
        idFormule: formuleDstvCompaq,
        montantEncaisse: 0,
        remise: 20000,
      })
    ).toThrow(/remise/i);
  });

  it("6.2 : la commission CANAL+ se calcule sur le montant réellement facturé (après remise)", () => {
    const tauxPourMille = 100; // 10 %
    db.update(schema.entreprise).set({ tauxCommissionVendeurDefaut: tauxPourMille }).run();

    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
      idFormule: formuleToutCanalPlus,
      montantEncaisse: 25000,
      remise: 3000, // 28000 -> 25000
    });

    const suivi = db
      .select()
      .from(schema.suiviCommissionCanalplus)
      .where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, resultat.numeroAbonnement))
      .get();
    expect(suivi?.montantCommission).toBe(2500); // 10 % de 25000, pas de 28000
  });
});

// 3.2.2, 5.4.2 : options complémentaires (ex. Option English Plus), avec
// règles de compatibilité et tarif différencié selon la formule support
describe("recruterAbonne — options complémentaires (3.2.2, 5.4.2)", () => {
  let optionEnglishPlus: number;
  let formuleAccess: number;
  let formuleAccessPlus: number;

  beforeEach(() => {
    optionEnglishPlus = db.insert(schema.optionComplement).values({ libelle: "Option English Plus", prix: 5000 }).returning().get().idOption;
    formuleAccess = db.insert(schema.formule).values({ idFamille: familleCanalPlus, libelle: "ACCESS", prix: 5000, rang: 1 }).returning().get().idFormule;
    formuleAccessPlus = db.insert(schema.formule).values({ idFamille: familleCanalPlus, libelle: "ACCESS+", prix: 15000, rang: 3 }).returning().get().idFormule;

    // 5.4.2 : "Option English Plus (formules ACCESS, EVASION) 5 000 FCFA" —
    // pas de prix_surcharge, utilise le prix par défaut de l'option
    db.insert(schema.formuleOptionCompat).values({ idFormule: formuleAccess, idOption: optionEnglishPlus }).run();
    // 5.4.2 : "Option English Plus (formule ACCESS+) 2 000 FCFA" — tarif différencié
    db.insert(schema.formuleOptionCompat).values({ idFormule: formuleAccessPlus, idOption: optionEnglishPlus, prixSurcharge: 2000 }).run();
  });

  it("facture l'option à son prix par défaut quand aucun tarif différencié n'est configuré pour la formule", () => {
    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
      idFormule: formuleAccess,
      idsOptions: [optionEnglishPlus],
      montantEncaisse: 10000,
    });

    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, resultat.idFacture)).get();
    expect(facture?.montantTotal).toBe(10000); // 5000 (ACCESS) + 5000 (option, prix par défaut)

    const lignes = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, resultat.idFacture)).all();
    const ligneOption = lignes.find((l) => l.idOption === optionEnglishPlus);
    expect(ligneOption?.prixApplique).toBe(5000);
    expect(ligneOption?.numeroAbonnement).toBe(resultat.numeroAbonnement);
  });

  it("facture l'option à son tarif différencié pour la formule support (5.4.2)", () => {
    const resultat = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
      idFormule: formuleAccessPlus,
      idsOptions: [optionEnglishPlus],
      montantEncaisse: 17000,
    });

    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, resultat.idFacture)).get();
    expect(facture?.montantTotal).toBe(17000); // 15000 (ACCESS+) + 2000 (tarif différencié)

    const lignes = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, resultat.idFacture)).all();
    const ligneOption = lignes.find((l) => l.idOption === optionEnglishPlus);
    expect(ligneOption?.prixApplique).toBe(2000);
  });

  it("rejette une option incompatible avec la formule choisie", () => {
    const autreFormule = db.insert(schema.formule).values({ idFamille: familleCanalPlus, libelle: "TOUT CANAL+ 2", prix: 28000, rang: 5 }).returning().get().idFormule;

    expect(() =>
      recruterAbonne(db, {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
        idFormule: autreFormule,
        idsOptions: [optionEnglishPlus],
        montantEncaisse: 0,
      })
    ).toThrow(/compatible/i);
  });
});
