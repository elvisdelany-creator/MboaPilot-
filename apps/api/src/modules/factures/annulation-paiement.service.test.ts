import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { annulerPaiement } from "./annulation-paiement.service.js";

let db: Db;
let siteId: number;
let userId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "GERANT" })
    .returning()
    .get().idUser;
});

function creerFacture(montantTotal: number, statut: "BROUILLON" | "VALIDEE" = "VALIDEE") {
  return db.insert(schema.facture).values({ siteId, idAbonne: null, creePar: userId, montantTotal, statut }).returning().get();
}

// 9.1, 11.5 : "Aucune opération destructrice (suppression de vente,
// annulation de paiement) sans confirmation et sans traçabilité"
describe("annulerPaiement (9.1, 11.5)", () => {
  it("retire le paiement et journalise la suppression (11.5)", () => {
    const facture = creerFacture(5000);
    const paiement = db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: 5000, utilisateurId: userId }).returning().get();

    annulerPaiement(db, { idPaiement: paiement.idPaiement, userId });

    expect(db.select().from(schema.paiement).where(eq(schema.paiement.idPaiement, paiement.idPaiement)).get()).toBeUndefined();

    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "paiement")).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "SUPPRESSION", idCible: String(paiement.idPaiement), utilisateurId: userId });
    expect(JSON.parse(audit[0].valeurAvant!)).toMatchObject({ idPaiement: paiement.idPaiement, montant: 5000, mode: "CASH" });
  });

  it("fait repasser la facture en BROUILLON si c'était le seul encaissement", () => {
    const facture = creerFacture(5000, "VALIDEE");
    const paiement = db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: 5000, utilisateurId: userId }).returning().get();

    const resultat = annulerPaiement(db, { idPaiement: paiement.idPaiement, userId });

    expect(resultat.statutFacture).toBe("BROUILLON");
    const apres = db.select().from(schema.facture).where(eq(schema.facture.idFacture, facture.idFacture)).get();
    expect(apres?.statut).toBe("BROUILLON");
  });

  it("laisse la facture VALIDEE s'il reste un autre encaissement", () => {
    const facture = creerFacture(10000, "VALIDEE");
    db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: 4000, utilisateurId: userId }).run();
    const paiementErrone = db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CHEQUE", montant: 6000, utilisateurId: userId }).returning().get();

    const resultat = annulerPaiement(db, { idPaiement: paiementErrone.idPaiement, userId });

    expect(resultat.statutFacture).toBe("VALIDEE");
    expect(resultat.totalPaye).toBe(4000);
    const apres = db.select().from(schema.facture).where(eq(schema.facture.idFacture, facture.idFacture)).get();
    expect(apres?.statut).toBe("VALIDEE");
  });

  it("rejette un paiement inconnu", () => {
    expect(() => annulerPaiement(db, { idPaiement: 999999, userId })).toThrow(/introuvable/i);
  });
});
