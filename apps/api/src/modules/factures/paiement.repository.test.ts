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

// 8.5, 9.2 : « calcul automatique de la monnaie rendue » — constaté en test
// grandeur nature : une vente de 5 000 FCFA réglée avec un billet de 10 000
// enregistrait 10 000 FCFA de paiement. La monnaie rendue n'est pas un
// encaissement : « Encaissements du jour » affichait 10 000 en CASH pour 5 000
// de CA, et la clôture de caisse (théorique CASH) signalait un faux manque égal
// à la monnaie rendue à chaque vente avec monnaie.
describe("creerPaiement — monnaie rendue (8.5, 9.2, 13.1)", () => {
  it("un paiement CASH supérieur au dû n'enregistre que le montant dû (le reste est rendu au client)", () => {
    const paiement = creerPaiement(db, { idFacture, mode: "CASH", montant: 15000, utilisateurId: userId });

    expect(paiement.montant).toBe(10000);
  });

  it("tient compte des paiements déjà enregistrés sur la facture", () => {
    creerPaiement(db, { idFacture, mode: "CASH", montant: 7000, utilisateurId: userId });

    const paiement = creerPaiement(db, { idFacture, mode: "CASH", montant: 5000, utilisateurId: userId });

    expect(paiement.montant).toBe(3000);
  });

  it("tient compte des avoirs déjà émis sur la facture", () => {
    db.insert(schema.facture)
      .values({ siteId: 1, type: "AVOIR", factureOrigineId: idFacture, montantTotal: -4000, creePar: userId, statut: "VALIDEE" })
      .run();

    const paiement = creerPaiement(db, { idFacture, mode: "CASH", montant: 10000, utilisateurId: userId });

    expect(paiement.montant).toBe(6000);
  });

  it("un paiement CASH inférieur ou égal au dû est enregistré tel quel", () => {
    expect(creerPaiement(db, { idFacture, mode: "CASH", montant: 4000, utilisateurId: userId }).montant).toBe(4000);
    expect(creerPaiement(db, { idFacture, mode: "CASH", montant: 6000, utilisateurId: userId }).montant).toBe(6000);
  });

  it("un chèque garde son montant : il n'y a pas de monnaie à rendre", () => {
    const paiement = creerPaiement(db, {
      idFacture,
      mode: "CHEQUE",
      montant: 15000,
      utilisateurId: userId,
      banque: "Afriland",
      numeroCheque: "123",
      titulaireCheque: "Client",
      dateCheque: "2026-09-01",
    });

    expect(paiement.montant).toBe(15000);
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
