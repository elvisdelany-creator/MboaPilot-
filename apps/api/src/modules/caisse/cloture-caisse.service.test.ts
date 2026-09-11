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

  it("n'attribue pas à une session les encaissements antérieurs à son ouverture", () => {
    encaisserVente(9000, "CASH", "2025-01-01 08:00:00"); // encaissé avant toute ouverture de session

    const cloture = ouvrirCaisse(db, { siteId, userId: caissierId, fondOuverture: 5000 });
    const resultat = fermerCaisse(db, { idCloture: cloture.idCloture, userId: caissierId, comptages: [{ mode: "CASH", montantCompte: 5000 }] });

    const cash = resultat.comptages.find((c) => c.mode === "CASH")!;
    expect(cash.montantTheorique).toBe(5000); // seulement le fond, pas les 9000 antérieurs
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
