import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { fermerCaisse, obtenirClotureOuverte, ouvrirCaisse } from "./cloture-caisse.service.js";

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
