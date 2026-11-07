import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { confirmerRapprochementVirement, listerVirementsARapprocher } from "./paiement.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let autreSiteId: number;
let userId: number;
let idAbonne: number;

// Constaté en test grandeur nature : un virement encaissé pour une vente sans client enregistré est accepté (facture soldée), mais
// le seul bouton de rapprochement vit sur la fiche d'un client — ce virement ne pouvait donc plus être rapproché depuis l'application,
// et le comptable n'avait aucune liste des virements à vérifier sur le relevé bancaire (6.5 : « différée (rapprochement) »).
beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasseHash: "x", role: "CAISSIER" }).returning().get().idUser;
  idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "690000000" }).returning().get().idAbonne;
});

function facture(site = siteId, abonne: number | null = idAbonne) {
  return db.insert(schema.facture).values({ siteId: site, idAbonne: abonne, creePar: userId, montantTotal: 10000 }).returning().get().idFacture;
}

function paiement(idFacture: number, mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY", extra: Partial<typeof schema.paiement.$inferInsert> = {}) {
  return db
    .insert(schema.paiement)
    .values({ idFacture, mode, montant: 10000, utilisateurId: userId, statutRapprochement: mode === "VIREMENT" ? "EN_ATTENTE" : null, ...extra })
    .returning()
    .get();
}

describe("listerVirementsARapprocher (6.5)", () => {
  it("liste les virements en attente avec de quoi les retrouver sur le relevé : banque, référence, montant, client, auteur", () => {
    const p = paiement(facture(), "VIREMENT", { banque: "Afriland", referenceVirement: "VIR-001", montant: 12500, datePaiement: "2026-11-07 09:00:00" });

    const { total, virements } = listerVirementsARapprocher(db, siteId);

    expect(total).toBe(1);
    expect(virements).toEqual([
      {
        idPaiement: p.idPaiement,
        idFacture: p.idFacture,
        montant: 12500,
        banque: "Afriland",
        referenceVirement: "VIR-001",
        datePaiement: "2026-11-07 09:00:00",
        abonnePrenom: "Marie",
        abonneNom: "Ngo",
        auteurPrenom: "Paul",
        auteurNom: "Nga",
      },
    ]);
  });

  it("garde un virement encaissé sans client enregistré : c'est lui qu'aucun écran ne permettait de rapprocher", () => {
    paiement(facture(siteId, null), "VIREMENT", { referenceVirement: "VIR-002" });

    const { virements } = listerVirementsARapprocher(db, siteId);

    expect(virements).toHaveLength(1);
    expect(virements[0].abonneNom).toBeNull();
    expect(virements[0].abonnePrenom).toBeNull();
  });

  it("ne liste ni les virements déjà rapprochés ni les autres modes de paiement", () => {
    const f = facture();
    const rapproche = paiement(f, "VIREMENT");
    confirmerRapprochementVirement(db, rapproche.idPaiement);
    paiement(f, "CASH");
    paiement(f, "CHEQUE");
    paiement(f, "MOBILE_MONEY");

    expect(listerVirementsARapprocher(db, siteId)).toEqual({ total: 0, virements: [] });
  });

  it("dès qu'un virement est rapproché, il quitte la liste", () => {
    const p = paiement(facture(), "VIREMENT");
    expect(listerVirementsARapprocher(db, siteId).total).toBe(1);

    confirmerRapprochementVirement(db, p.idPaiement);

    expect(listerVirementsARapprocher(db, siteId).total).toBe(0);
  });

  it("ne montre que les virements du site demandé", () => {
    paiement(facture(siteId), "VIREMENT", { referenceVirement: "ICI" });
    paiement(facture(autreSiteId, null), "VIREMENT", { referenceVirement: "AILLEURS" });

    expect(listerVirementsARapprocher(db, siteId).virements.map((v) => v.referenceVirement)).toEqual(["ICI"]);
    expect(listerVirementsARapprocher(db, autreSiteId).virements.map((v) => v.referenceVirement)).toEqual(["AILLEURS"]);
  });

  it("met le plus ancien en tête, et borne la liste en annonçant le total", () => {
    paiement(facture(), "VIREMENT", { referenceVirement: "C", datePaiement: "2026-11-07 10:00:00" });
    paiement(facture(), "VIREMENT", { referenceVirement: "A", datePaiement: "2026-11-05 10:00:00" });
    paiement(facture(), "VIREMENT", { referenceVirement: "B", datePaiement: "2026-11-06 10:00:00" });

    const complet = listerVirementsARapprocher(db, siteId);
    const borne = listerVirementsARapprocher(db, siteId, 2);

    expect(complet.virements.map((v) => v.referenceVirement)).toEqual(["A", "B", "C"]);
    expect(borne.total).toBe(3);
    expect(borne.virements.map((v) => v.referenceVirement)).toEqual(["A", "B"]);
  });
});
