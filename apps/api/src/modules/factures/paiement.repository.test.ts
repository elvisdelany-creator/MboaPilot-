import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerPaiement, confirmerRapprochementVirement } from "./paiement.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let idFacture: number;
let userId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const site = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get();
  const user = db
    .insert(schema.utilisateur)
    .values({ siteId: site.idSite, nom: "N", prenom: "P", identifiant: "user1", motDePasseHash: "x", role: "CAISSIER" })
    .returning()
    .get();
  const abonne = db.insert(schema.abonne).values({ siteId: site.idSite, nom: "Client", prenom: "Test", telephone: "690000000" }).returning().get();
  const facture = db.insert(schema.facture).values({ siteId: site.idSite, idAbonne: abonne.idAbonne, creePar: user.idUser, montantTotal: 10000 }).returning().get();
  idFacture = facture.idFacture;
  userId = user.idUser;
});

// 6.5 : "Virement bancaire — Différée (rapprochement)" contrairement au
// comptant et au chèque, "Immédiate" — un virement démarre donc EN_ATTENTE,
// les autres modes n'ont aucun statut de rapprochement (null, non applicable).
describe("creerPaiement (6.5)", () => {
  it("un paiement CASH n'a aucun statut de rapprochement", () => {
    const paiement = creerPaiement(db, { idFacture, mode: "CASH", montant: 10000, utilisateurId: userId });
    expect(paiement.statutRapprochement).toBeNull();
  });

  it("un paiement CHEQUE n'a aucun statut de rapprochement (validation immédiate malgré le risque d'impayé)", () => {
    const paiement = creerPaiement(db, { idFacture, mode: "CHEQUE", montant: 10000, utilisateurId: userId, banque: "Afriland", numeroCheque: "123", titulaireCheque: "Client", dateCheque: "2026-09-01" });
    expect(paiement.statutRapprochement).toBeNull();
  });

  it("un paiement VIREMENT démarre EN_ATTENTE de rapprochement", () => {
    const paiement = creerPaiement(db, { idFacture, mode: "VIREMENT", montant: 10000, utilisateurId: userId, banque: "Afriland", referenceVirement: "VIR-001" });
    expect(paiement.statutRapprochement).toBe("EN_ATTENTE");
  });
});

describe("confirmerRapprochementVirement (6.5)", () => {
  it("passe un virement EN_ATTENTE à RAPPROCHE", () => {
    const paiement = creerPaiement(db, { idFacture, mode: "VIREMENT", montant: 10000, utilisateurId: userId, referenceVirement: "VIR-001" });

    const confirme = confirmerRapprochementVirement(db, paiement.idPaiement);

    expect(confirme.statutRapprochement).toBe("RAPPROCHE");
    const relu = db.select().from(schema.paiement).where(eq(schema.paiement.idPaiement, paiement.idPaiement)).get();
    expect(relu?.statutRapprochement).toBe("RAPPROCHE");
  });

  it("rejette un paiement introuvable", () => {
    expect(() => confirmerRapprochementVirement(db, 999999)).toThrow(/introuvable/);
  });

  it("rejette un paiement qui n'est pas un virement", () => {
    const paiement = creerPaiement(db, { idFacture, mode: "CASH", montant: 10000, utilisateurId: userId });

    expect(() => confirmerRapprochementVirement(db, paiement.idPaiement)).toThrow(/virement/i);
  });

  it("rejette un virement déjà rapproché", () => {
    const paiement = creerPaiement(db, { idFacture, mode: "VIREMENT", montant: 10000, utilisateurId: userId });
    confirmerRapprochementVirement(db, paiement.idPaiement);

    expect(() => confirmerRapprochementVirement(db, paiement.idPaiement)).toThrow(/déjà/i);
  });
});
