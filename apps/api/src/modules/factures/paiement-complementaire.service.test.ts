import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { encaisserSoldeFacture } from "./paiement-complementaire.service.js";

let db: Db;
let siteId: number;
let userId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
});

function creerFacture(montantTotal: number, statut: "BROUILLON" | "VALIDEE" = "BROUILLON") {
  return db.insert(schema.facture).values({ siteId, idAbonne: null, creePar: userId, montantTotal, statut }).returning().get();
}

// 6.4 point 5, 9.4 : "un solde restant dû reste visible et peut faire l'objet
// d'encaissements complémentaires ultérieurs"
describe("encaisserSoldeFacture (6.4, 9.4)", () => {
  it("encaisse un premier paiement sur une facture BROUILLON non encore payée, qui passe VALIDEE", () => {
    const facture = creerFacture(10000);

    const resultat = encaisserSoldeFacture(db, { idFacture: facture.idFacture, userId, montant: 4000 });

    expect(resultat.soldeRestant).toBe(6000);
    expect(resultat.statutFacture).toBe("VALIDEE");
    const apres = db.select().from(schema.facture).where(eq(schema.facture.idFacture, facture.idFacture)).get();
    expect(apres?.statut).toBe("VALIDEE");
  });

  it("encaisse un paiement complémentaire sur une facture déjà VALIDEE avec un solde restant dû", () => {
    const facture = creerFacture(10000, "VALIDEE");
    db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: 4000, utilisateurId: userId }).run();

    const resultat = encaisserSoldeFacture(db, { idFacture: facture.idFacture, userId, montant: 6000 });

    expect(resultat.soldeRestant).toBe(0);
    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, facture.idFacture)).all();
    expect(paiements).toHaveLength(2);
  });

  it("rejette un encaissement sur une facture déjà intégralement payée", () => {
    const facture = creerFacture(10000, "VALIDEE");
    db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: 10000, utilisateurId: userId }).run();

    expect(() => encaisserSoldeFacture(db, { idFacture: facture.idFacture, userId, montant: 1000 })).toThrow(/intégralement/i);
  });

  it("rejette un montant négatif ou nul", () => {
    const facture = creerFacture(10000);

    expect(() => encaisserSoldeFacture(db, { idFacture: facture.idFacture, userId, montant: 0 })).toThrow();
    expect(() => encaisserSoldeFacture(db, { idFacture: facture.idFacture, userId, montant: -500 })).toThrow();
  });

  it("rejette un encaissement complémentaire sur un avoir", () => {
    const facture = creerFacture(-5000, "VALIDEE");
    db.update(schema.facture).set({ type: "AVOIR" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();

    expect(() => encaisserSoldeFacture(db, { idFacture: facture.idFacture, userId, montant: 1000 })).toThrow(/avoir/i);
  });

  it("rejette une facture inconnue", () => {
    expect(() => encaisserSoldeFacture(db, { idFacture: 999999, userId, montant: 1000 })).toThrow(/introuvable/i);
  });

  // 6.5 : "Chèque — Banque, numéro de chèque, titulaire, date"
  it("enregistre le mode de paiement et les champs propres au chèque", () => {
    const facture = creerFacture(10000);

    encaisserSoldeFacture(db, {
      idFacture: facture.idFacture,
      userId,
      montant: 10000,
      modePaiement: "CHEQUE",
      banque: "BICEC",
      numeroCheque: "0012345",
      titulaireCheque: "Client Test",
      dateCheque: "2025-12-01",
    });

    const paiement = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, facture.idFacture)).get();
    expect(paiement?.mode).toBe("CHEQUE");
    expect(paiement?.banque).toBe("BICEC");
    expect(paiement?.numeroCheque).toBe("0012345");
  });
});
