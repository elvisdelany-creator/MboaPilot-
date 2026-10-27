import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { fermerCaisse, listerClotures, obtenirClotureOuverte, ouvrirCaisse } from "./cloture-caisse.service.js";
import { creerApporteur } from "../apporteurs/apporteur.repository.js";

let db: Db;
let siteId: number;
let caissierId: number;
let idFormule: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  caissierId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  const gerantId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "G", prenom: "E", identifiant: "ge", motDePasseHash: "h", role: "GERANT" })
    .returning()
    .get().idUser;
  void gerantId;

  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  idFormule = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "ACCESS", prix: 5000, rang: 1 }).returning().get().idFormule;
});

function encaisserVente(montant: number, mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY" = "CASH", datePaiement?: string) {
  const facture = db.insert(schema.facture).values({ siteId, idAbonne: null, creePar: caissierId, montantTotal: montant, statut: "VALIDEE" }).returning().get();
  db.insert(schema.paiement)
    .values({ idFacture: facture.idFacture, mode, montant, utilisateurId: caissierId, ...(datePaiement !== undefined && { datePaiement }) })
    .run();
  return facture;
}

describe("ouvrirCaisse (13.1)", () => {
  it("ouvre une session de caisse avec le fond d'ouverture déclaré", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 20000 });

    expect(cloture.statut).toBe("OUVERTE");
    expect(cloture.fondOuverture).toBe(20000);
    expect(cloture.ouvertPar).toBe(caissierId);
  });

  it("refuse d'ouvrir une deuxième session tant que la précédente n'est pas fermée", () => {
    ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 20000 });

    expect(() => ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 10000 })).toThrow(/déjà ouverte/i);
  });

  it("refuse un fond d'ouverture négatif", () => {
    expect(() => ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: -500 })).toThrow();
  });
});

describe("fermerCaisse (13.1) — écart théorique/réel par mode de paiement", () => {
  it("calcule l'écart théorique/réel par mode et clôture la session", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 20000 });
    encaisserVente(5000, "CASH");
    encaisserVente(3000, "CASH");
    encaisserVente(13000, "CHEQUE");

    const resultat = fermerCaisse(db, {
      idCloture: cloture.idCloture,
      userId: caissierId,
      comptages: [
        { mode: "CASH", montantCompte: 27800 }, // théorique 20000 + 8000 = 28000 -> écart -200
        { mode: "CHEQUE", montantCompte: 13000 }, // théorique 13000 -> écart 0
      ],
    });

    const cash = resultat.comptages.find((c) => c.mode === "CASH")!;
    expect(cash.montantTheorique).toBe(28000);
    expect(cash.montantCompte).toBe(27800);
    expect(cash.ecart).toBe(-200);

    const cheque = resultat.comptages.find((c) => c.mode === "CHEQUE")!;
    expect(cheque.montantTheorique).toBe(13000);
    expect(cheque.ecart).toBe(0);

    // modes sans mouvement : théorique 0, comptage par défaut 0, écart 0
    const virement = resultat.comptages.find((c) => c.mode === "VIREMENT")!;
    expect(virement.montantTheorique).toBe(0);
    expect(virement.ecart).toBe(0);

    expect(resultat.cloture.statut).toBe("FERMEE");
    expect(resultat.cloture.ecartTotal).toBe(-200);
    expect(resultat.cloture.fermePar).toBe(caissierId);

    const stockee = db.select().from(schema.clotureCaisseComptage).where(eq(schema.clotureCaisseComptage.idCloture, cloture.idCloture)).all();
    expect(stockee).toHaveLength(4);
  });

  // 13.1 : rien ne bloque un encaissement pendant que la caisse est "fermée"
  // (pas de session ouverte) — le théorique de la PREMIÈRE clôture jamais
  // faite pour un site doit donc rattraper tout ce qui a été encaissé avant
  // elle, sous peine de faire disparaître définitivement ce chiffre d'affaires
  // de toute réconciliation.
  it("rattache à la toute première clôture d'un site les encaissements antérieurs à son ouverture", () => {
    encaisserVente(9000, "CASH", "2025-01-01 08:00:00"); // encaissé avant toute ouverture de session

    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 5000 });
    const resultat = fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 14000 }] });

    const cash = resultat.comptages.find((c) => c.mode === "CASH")!;
    expect(cash.montantTheorique).toBe(14000); // le fond (5000) + les 9000 antérieurs, sinon ils s'évaporent
    expect(cash.ecart).toBe(0);
  });

  // 13.1 : reproduit le bug réel constaté en test grandeur nature — une vente
  // encaissée entre deux sessions de caisse (caisse "fermée") ne doit pas
  // devenir un écart fantôme sur la clôture suivante.
  it("rattrape, sur la clôture suivante, les encaissements reçus dans l'intervalle entre deux sessions", () => {
    const clotureA = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 5000 });
    fermerCaisse(db, { idCloture: clotureA.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 5000 }] });
    // horodatages explicites, le MÊME jour, pour exercer précisément le cas
    // réel constaté (clôture, vente, réouverture, le même jour) plutôt que de
    // dépendre du minutage réel de l'exécution du test
    db.update(schema.clotureCaisse).set({ dateFermeture: "2025-06-01 10:00:00" }).where(eq(schema.clotureCaisse.idCloture, clotureA.idCloture)).run();

    // vente réalisée alors qu'aucune session n'est ouverte (caisse "fermée")
    encaisserVente(3200, "CASH", "2025-06-01 14:00:00");

    const clotureB = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 0 });
    db.update(schema.clotureCaisse).set({ dateOuverture: "2025-06-01 18:00:00" }).where(eq(schema.clotureCaisse.idCloture, clotureB.idCloture)).run();
    const resultat = fermerCaisse(db, { idCloture: clotureB.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 3200 }] });

    const cash = resultat.comptages.find((c) => c.mode === "CASH")!;
    expect(cash.montantTheorique).toBe(3200); // et non 0 : sinon écart fantôme de +3200
    expect(cash.ecart).toBe(0);
  });

  it("journalise la clôture (11.5)", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 5000 });
    fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 5000 }] });

    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "cloture_caisse")).all();
    expect(audit).toHaveLength(1);
    expect(audit[0].idCible).toBe(String(cloture.idCloture));
  });

  it("refuse de fermer une session déjà fermée", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 5000 });
    fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 5000 }] });

    expect(() => fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 5000 }] })).toThrow(/déjà fermée/i);
  });
});

// 6.3, 13.1 : un règlement de commission en espèces sort physiquement du tiroir-caisse. Le théorique ne comptait que les encaissements et
// les remboursements d'avoir : chaque commission payée en espèces laissait donc le tiroir en déficit de son montant à la clôture, un faux écart.
// 13.1 : « c'est l'un des premiers contrôles qu'un gérant réclamera à l'usage » — l'historique des sessions, avec qui a ouvert et fermé
describe("listerClotures (13.1) — historique des sessions", () => {
  const comptagesJuste = (cash: number) => [
    { mode: "CASH" as const, montantCompte: cash },
    { mode: "CHEQUE" as const, montantCompte: 0 },
    { mode: "VIREMENT" as const, montantCompte: 0 },
    { mode: "MOBILE_MONEY" as const, montantCompte: 0 },
  ];
  const gerant = () => db.select().from(schema.utilisateur).where(eq(schema.utilisateur.identifiant, "ge")).get()!.idUser;

  it("nomme l'utilisateur qui a ouvert et celui qui a fermé la session, du plus récent au plus ancien", () => {
    const premiere = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 10000 });
    fermerCaisse(db, { idCloture: premiere.idCloture, userId: gerant(), comptages: comptagesJuste(10000) });
    ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 5000 });

    const liste = listerClotures(db, siteId);

    expect(liste.map((c) => c.fondOuverture)).toEqual([5000, 10000]);
    expect(liste[0]).toMatchObject({ statut: "OUVERTE", ouvertParNom: "B A", fermeParNom: null });
    expect(liste[1]).toMatchObject({ statut: "FERMEE", ouvertParNom: "B A", fermeParNom: "E G", ecartTotal: 0 });
  });

  it("ne liste que les sessions du site demandé", () => {
    const idEntreprise = db.select().from(schema.site).get()!.idEntreprise;
    const autreSite = db.insert(schema.site).values({ idEntreprise, nom: "Site B" }).returning().get().idSite;
    ouvrirCaisse(db, { siteId: autreSite, userId: caissierId, fondOuverture: 1 });
    ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 2 });

    expect(listerClotures(db, siteId).map((c) => c.fondOuverture)).toEqual([2]);
  });

  it("borne l'historique aux sessions les plus récentes", () => {
    for (let i = 0; i < 5; i++) {
      const c = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: i });
      fermerCaisse(db, { idCloture: c.idCloture, userId: gerant(), comptages: comptagesJuste(i) });
    }

    const liste = listerClotures(db, siteId, 3);

    expect(liste.map((c) => c.fondOuverture)).toEqual([4, 3, 2]);
  });
});

// 13.1 : la frontière entre deux sessions se jugeait à la seconde près (`>=` sur la date de fermeture) : un encaissement fait dans la même
// seconde que la fermeture était compté deux fois, dans la session fermée puis dans la suivante. Chaque clôture retient désormais le
// dernier paiement et le dernier règlement qu'elle a comptés : la session suivante reprend strictement après.
describe("fermerCaisse (13.1) — frontière exacte entre deux sessions", () => {
  const comptage = (cash: number) => [{ mode: "CASH" as const, montantCompte: cash }];
  const theoriqueCash = (resultat: ReturnType<typeof fermerCaisse>) => resultat.comptages.find((c) => c.mode === "CASH")!.montantTheorique;

  it("ne recompte pas, dans la session suivante, un encaissement déjà compté, même fait dans la même seconde que la fermeture", () => {
    const premiere = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 10000 });
    encaisserVente(2500, "CASH");
    fermerCaisse(db, { idCloture: premiere.idCloture, userId: caissierId, comptages: comptage(12500) });

    const seconde = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 0 });
    encaisserVente(3000, "CASH");
    const resultat = fermerCaisse(db, { idCloture: seconde.idCloture, userId: caissierId, comptages: comptage(3000) });

    expect(theoriqueCash(resultat)).toBe(3000);
    expect(resultat.cloture.ecartTotal).toBe(0);
  });

  it("compte, dans la session suivante, un encaissement fait après la fermeture et avant l'ouverture, même dans la même seconde", () => {
    const premiere = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 10000 });
    fermerCaisse(db, { idCloture: premiere.idCloture, userId: caissierId, comptages: comptage(10000) });
    encaisserVente(1500, "CASH"); // caisse fermée : rien n'empêche de vendre

    const seconde = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 500 });
    const resultat = fermerCaisse(db, { idCloture: seconde.idCloture, userId: caissierId, comptages: comptage(2000) });

    expect(theoriqueCash(resultat)).toBe(2000); // fond 500 + 1 500 encaissés pendant l'intervalle
  });

  it("ne déduit pas deux fois un règlement d'apporteur en espèces fait dans la même seconde que la fermeture", () => {
    const apporteur = creerApporteur(db, { nom: "Agence Kamga", tauxCommissionDefaut: 100 });
    const premiere = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 10000 });
    db.insert(schema.reglementCommission).values({ apporteurId: apporteur.idApporteur, montant: 4000, modePaiement: "CASH", utilisateurId: caissierId }).run();
    fermerCaisse(db, { idCloture: premiere.idCloture, userId: caissierId, comptages: comptage(6000) });

    const seconde = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 6000 });
    const resultat = fermerCaisse(db, { idCloture: seconde.idCloture, userId: caissierId, comptages: comptage(6000) });

    expect(theoriqueCash(resultat)).toBe(6000);
  });

  it("retombe sur la date de fermeture pour une clôture déjà en base, qui n'a retenu aucune frontière", () => {
    db.insert(schema.clotureCaisse)
      .values({ siteId, fondOuverture: 1000, ouvertPar: caissierId, statut: "FERMEE", fermePar: caissierId, dateOuverture: "2025-01-01 08:00:00", dateFermeture: "2025-01-01 18:00:00", ecartTotal: 0 })
      .run();
    encaisserVente(4000, "CASH", "2025-01-01 12:00:00"); // avant la fermeture : déjà compté par l'ancienne clôture
    encaisserVente(600, "CASH", "2025-01-02 09:00:00"); // après

    const seconde = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 1000 });
    const resultat = fermerCaisse(db, { idCloture: seconde.idCloture, userId: caissierId, comptages: comptage(1600) });

    expect(theoriqueCash(resultat)).toBe(1600);
  });

  it("garde les paiements des autres sites hors du théorique et de la frontière", () => {
    const idEntreprise = db.select().from(schema.site).get()!.idEntreprise;
    const autreSite = db.insert(schema.site).values({ idEntreprise, nom: "Site B" }).returning().get().idSite;
    const premiere = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 1000 });
    fermerCaisse(db, { idCloture: premiere.idCloture, userId: caissierId, comptages: comptage(1000) });
    const factureB = db.insert(schema.facture).values({ siteId: autreSite, idAbonne: null, creePar: caissierId, montantTotal: 9000, statut: "VALIDEE" }).returning().get();
    db.insert(schema.paiement).values({ idFacture: factureB.idFacture, mode: "CASH", montant: 9000, utilisateurId: caissierId }).run();
    encaisserVente(700, "CASH");

    const seconde = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 1000 });
    const resultat = fermerCaisse(db, { idCloture: seconde.idCloture, userId: caissierId, comptages: comptage(1700) });

    expect(theoriqueCash(resultat)).toBe(1700);
  });
});

describe("fermerCaisse (13.1) — règlements de commission d'apporteur", () => {
  function regler(montant: number, modePaiement: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY", options: { utilisateurId?: number; dateReglement?: string } = {}) {
    const apporteur = db.select().from(schema.sousDistributeur).get() ?? creerApporteur(db, { nom: "Agence Kamga", tauxCommissionDefaut: 100 });
    db.insert(schema.reglementCommission)
      .values({ apporteurId: apporteur.idApporteur, montant, modePaiement, utilisateurId: options.utilisateurId ?? caissierId, ...(options.dateReglement !== undefined && { dateReglement: options.dateReglement }) })
      .run();
  }

  it("un règlement en espèces est déduit du théorique des espèces : le tiroir compté ne présente aucun écart", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 10000 });
    encaisserVente(30000, "CASH");
    regler(4000, "CASH");

    const resultat = fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 36000 }] }); // 10 000 + 30 000 − 4 000

    const cash = resultat.comptages.find((c) => c.mode === "CASH")!;
    expect(cash.montantTheorique).toBe(36000);
    expect(cash.ecart).toBe(0);
  });

  it("un règlement par chèque, virement ou Mobile Money ne sort pas d'espèces du tiroir", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 10000 });
    encaisserVente(30000, "CASH");
    regler(4000, "VIREMENT");
    regler(1000, "CHEQUE");
    regler(500, "MOBILE_MONEY");

    const resultat = fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 40000 }] });

    expect(resultat.comptages.find((c) => c.mode === "CASH")!.montantTheorique).toBe(40000);
    expect(resultat.comptages.find((c) => c.mode === "VIREMENT")!.montantTheorique).toBe(0);
  });

  it("un règlement fait avant la dernière clôture n'est pas déduit une seconde fois à la clôture suivante", () => {
    const premiere = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 5000 });
    regler(2000, "CASH", { dateReglement: "2025-01-01 09:00:00" });
    fermerCaisse(db, { idCloture: premiere.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 3000 }] });

    const seconde = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 3000 });
    encaisserVente(1000, "CASH");
    const resultat = fermerCaisse(db, { idCloture: seconde.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 4000 }] });

    expect(resultat.comptages.find((c) => c.mode === "CASH")!.montantTheorique).toBe(4000);
  });

  it("le règlement fait par un utilisateur d'un autre site ne sort pas de ce tiroir", () => {
    const autreSite = db.insert(schema.site).values({ idEntreprise: db.select().from(schema.entreprise).get()!.idEntreprise, nom: "Site B" }).returning().get().idSite;
    const autreUtilisateur = db
      .insert(schema.utilisateur)
      .values({ siteId: autreSite, nom: "C", prenom: "D", identifiant: "cd", motDePasseHash: "h", role: "GERANT" })
      .returning()
      .get().idUser;
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 10000 });
    regler(4000, "CASH", { utilisateurId: autreUtilisateur });

    const resultat = fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 10000 }] });

    expect(resultat.comptages.find((c) => c.mode === "CASH")!.montantTheorique).toBe(10000);
  });
});

describe("obtenirClotureOuverte (13.1)", () => {
  it("retourne la session ouverte du site, ou undefined si aucune", () => {
    expect(obtenirClotureOuverte(db, siteId)).toBeUndefined();

    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 5000 });
    expect(obtenirClotureOuverte(db, siteId)?.idCloture).toBe(cloture.idCloture);

    fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 5000 }] });
    expect(obtenirClotureOuverte(db, siteId)).toBeUndefined();
  });
});

// 13.1 : constaté en test grandeur nature — « create validates, modify doesn't » :
// le fond d'ouverture « abc » était stocké tel quel dans une colonne entière, et
// la fermeture acceptait des comptages vides, négatifs, décimaux ou mal formés
// (un comptage null valait 0 : écart fantôme de tout le tiroir, caisse fermée).
describe("validation des montants de clôture (13.1)", () => {
  it.each([["abc"], [1.5], [Number.NaN], [null], [undefined]])("refuse un fond d'ouverture non entier : %s", (fond) => {
    expect(() => ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: fond as never })).toThrow(/fond de caisse/i);
    expect(obtenirClotureOuverte(db, siteId)).toBeUndefined();
  });

  it.each([
    ["comptages absent", undefined],
    ["comptages null", null],
    ["comptages non tableau", "x"],
    ["élément null", [null]],
    ["mode inconnu", [{ mode: "BITCOIN", montantCompte: 5 }]],
    ["mode répété", [{ mode: "CASH", montantCompte: 5 }, { mode: "CASH", montantCompte: 6 }]],
    ["montant texte", [{ mode: "CASH", montantCompte: "abc" }]],
    ["montant null", [{ mode: "CASH", montantCompte: null }]],
    ["montant négatif", [{ mode: "CASH", montantCompte: -5000 }]],
    ["montant décimal", [{ mode: "CASH", montantCompte: 1.5 }]],
  ])("refuse un comptage invalide (%s) sans fermer la session ni écrire de ligne", (_libelle, comptages) => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 10000 });

    expect(() => fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: comptages as never })).toThrow(/Comptage invalide/);

    expect(obtenirClotureOuverte(db, siteId)?.idCloture).toBe(cloture.idCloture);
    expect(db.select().from(schema.clotureCaisseComptage).all()).toHaveLength(0);
  });

  it("ne laisse aucune ligne de comptage orpheline quand un mode suivant est invalide", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 10000 });

    expect(() =>
      fermerCaisse(db, {
        idCloture: cloture.idCloture,
        userId: caissierId,
        comptages: [{ mode: "CASH", montantCompte: 10000 }, { mode: "CHEQUE", montantCompte: "abc" as never }],
      })
    ).toThrow(/Comptage invalide/);

    expect(db.select().from(schema.clotureCaisseComptage).all()).toHaveLength(0);
  });
});

// 13.1 : Number.isInteger(1e30) est vrai — un fond ou un comptage de 1e30 était
// accepté et stocké en réel (constaté par fuzz de types).
describe("montants de clôture géants (13.1)", () => {
  it("refuse un fond d'ouverture de 1e30", () => {
    expect(() => ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 1e30 })).toThrow(/fond de caisse/i);
  });

  it("refuse un comptage de 1e30 sans fermer la session", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 1000 });
    expect(() => fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 1e30 }] })).toThrow(/Comptage invalide/);
    expect(obtenirClotureOuverte(db, siteId)?.idCloture).toBe(cloture.idCloture);
  });
});

// Constaté en test grandeur nature : un fond de caisse de 9 007 199 254 740 991 FCFA (limite des entiers sûrs)
// était accepté, et l'écart total de la clôture dépassait alors la précision des additions. Et une fermeture
// qui échoue en cours de route laissait des lignes de comptage orphelines (doublonnées au second essai).
describe("clôture : plafond des montants et fermeture atomique (13.1)", () => {
  const PLAFOND = 10_000_000_000;

  it("refuse un fond d'ouverture au-delà de 10 milliards de FCFA, et accepte exactement le plafond", () => {
    expect(() => ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: PLAFOND + 1 })).toThrow(/fond de caisse.*10 000 000 000/i);
    expect(ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: PLAFOND }).fondOuverture).toBe(PLAFOND);
  });

  it("refuse un montant compté au-delà du plafond, sans fermer la session", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 1000 });

    expect(() => fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: PLAFOND + 1 }] })).toThrow(/montant compté.*10 000 000 000/i);
    expect(obtenirClotureOuverte(db, siteId)?.idCloture).toBe(cloture.idCloture);
  });

  it("n'écrit rien quand la fermeture échoue en cours de route (aucune ligne de comptage orpheline)", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 1000 });

    // un auteur inexistant fait échouer la mise à jour finale, APRÈS l'écriture des comptages
    expect(() => fermerCaisse(db, { idCloture: cloture.idCloture, userId: 99999, comptages: [{ mode: "CASH", montantCompte: 1000 }] })).toThrow();

    expect(db.select().from(schema.clotureCaisseComptage).all()).toHaveLength(0);
    expect(obtenirClotureOuverte(db, siteId)?.idCloture).toBe(cloture.idCloture);
    expect(db.select().from(schema.journalAudit).all()).toHaveLength(0);
  });

  it("permet de refermer normalement après un échec : un seul jeu de comptages", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 1000 });
    expect(() => fermerCaisse(db, { idCloture: cloture.idCloture, userId: 99999, comptages: [] })).toThrow();

    fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 1000 }] });

    expect(db.select().from(schema.clotureCaisseComptage).all()).toHaveLength(4);
  });
});
