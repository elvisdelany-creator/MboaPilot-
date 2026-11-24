import { describe, it, expect, beforeAll } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { apercuExportComptable, exporterJournalEncaissementsCsv, exporterJournalVentesCsv } from "./export-comptable.service.js";
import { apercuExportComptableCedant, exporterJournalEncaissementsCsvCedant, exporterJournalVentesCsvCedant } from "./export-comptable-cedant.js";

// Test grandeur nature (200 000 factures sur deux ans) : un export comptable d'un an bloquait la boutique 2,4 à 4,3 secondes (aperçu, journal
// des ventes, journal des encaissements). Le calcul se fait maintenant par tranches de jours, avec une pause entre deux tranches : le
// résultat doit être exactement le même, tranche après tranche, et les autres requêtes doivent pouvoir passer entre deux.

let db: Db;
let siteId: number;
const PERIODE = { du: "2026-09-01", au: "2026-11-30" };

function generateur(graine: number) {
  let etat = graine;
  return (n: number) => {
    etat = (etat * 1664525 + 1013904223) % 4294967296;
    return Math.floor((etat / 4294967296) * n);
  };
}

beforeAll(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  const autreSite = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  const userId = db.insert(schema.utilisateur).values({ siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  const abonnes = [1, 2, 3, 4, 5].map((i) => db.insert(schema.abonne).values({ siteId, nom: `Nom${i}`, prenom: `Prenom${i}`, telephone: `67700000${i}` }).returning().get().idAbonne);
  const produits = [1, 2, 3].map((i) => db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: `Article ${i}`, prixVente: 1000 * i }).returning().get().idProduit);
  const alea = generateur(7);
  const modes = ["CASH", "CHEQUE", "VIREMENT", "MOBILE_MONEY"] as const;
  for (let i = 0; i < 260; i++) {
    const jour = 1 + alea(91); // du 1er septembre au 30 novembre
    const date = new Date(Date.UTC(2026, 8, jour)).toISOString().slice(0, 10);
    const horodatage = `${date} ${String(alea(23)).padStart(2, "0")}:${String(alea(60)).padStart(2, "0")}:00`;
    const total = 1000 * (1 + alea(9));
    const f = db
      .insert(schema.facture)
      .values({
        siteId: i % 17 === 0 ? autreSite : siteId, // quelques factures de l'autre boutique
        idAbonne: i % 6 === 0 ? null : abonnes[alea(abonnes.length)],
        creePar: userId,
        statut: i % 13 === 0 ? "BROUILLON" : "VALIDEE", // quelques ventes en attente
        montantTotal: total,
        montantTaxe: Math.floor(total / 10),
        dateCreation: horodatage,
      })
      .returning()
      .get();
    db.insert(schema.ligneVente).values({ idFacture: f.idFacture, idProduit: produits[alea(3)], quantite: 1 + alea(3), prixApplique: total }).run();
    const paye = alea(3) === 0 ? Math.floor(total / 2) : total;
    db.insert(schema.paiement).values({ idFacture: f.idFacture, mode: modes[alea(4)], montant: paye, utilisateurId: userId, datePaiement: horodatage }).run();
    if (alea(3) === 0) {
      // un solde réglé plus tard, et un avoir qui rembourse une partie
      const plusTard = new Date(Date.UTC(2026, 8, jour + 1 + alea(10))).toISOString().slice(0, 10);
      db.insert(schema.paiement).values({ idFacture: f.idFacture, mode: "CASH", montant: 500, utilisateurId: userId, datePaiement: `${plusTard} 10:00:00` }).run();
    }
    if (f.statut === "VALIDEE" && alea(7) === 0) {
      const avoir = db
        .insert(schema.facture)
        .values({ siteId: f.siteId, idAbonne: f.idAbonne, creePar: userId, statut: "VALIDEE", type: "AVOIR", factureOrigineId: f.idFacture, montantTotal: -500, montantTaxe: -50, dateCreation: `${date} 18:00:00` })
        .returning()
        .get();
      db.insert(schema.paiement).values({ idFacture: avoir.idFacture, mode: "CASH", montant: -500, utilisateurId: userId, datePaiement: `${date} 18:00:00` }).run();
    }
  }
});

const TAILLES = [1, 2, 7, 31, 400];

describe("export comptable par tranches : même résultat que le calcul d'un seul bloc", () => {
  it("journal des ventes", async () => {
    const attendu = exporterJournalVentesCsv(db, siteId, PERIODE);
    expect(attendu.nombre).toBeGreaterThan(100);
    for (const joursParTranche of TAILLES) expect(await exporterJournalVentesCsvCedant(db, siteId, PERIODE, { joursParTranche })).toEqual(attendu);
    expect(await exporterJournalVentesCsvCedant(db, siteId, PERIODE)).toEqual(attendu);
  });

  it("journal des encaissements", async () => {
    const attendu = exporterJournalEncaissementsCsv(db, siteId, PERIODE);
    expect(attendu.nombre).toBeGreaterThan(100);
    for (const joursParTranche of TAILLES) expect(await exporterJournalEncaissementsCsvCedant(db, siteId, PERIODE, { joursParTranche })).toEqual(attendu);
    expect(await exporterJournalEncaissementsCsvCedant(db, siteId, PERIODE)).toEqual(attendu);
  });

  it("aperçu", async () => {
    const attendu = apercuExportComptable(db, siteId, PERIODE);
    expect(attendu.ventes.nombre).toBeGreaterThan(100);
    for (const joursParTranche of TAILLES) expect(await apercuExportComptableCedant(db, siteId, PERIODE, { joursParTranche })).toEqual(attendu);
    expect(await apercuExportComptableCedant(db, siteId, PERIODE)).toEqual(attendu);
  });

  it("refuse une période invalide, comme le calcul d'un seul bloc", async () => {
    await expect(exporterJournalVentesCsvCedant(db, siteId, { du: "2026-11-30", au: "2026-11-01" })).rejects.toThrow("La période est inversée");
    await expect(exporterJournalEncaissementsCsvCedant(db, siteId, { du: "2026-02-30", au: "2026-03-01" })).rejects.toThrow("date valide");
    await expect(apercuExportComptableCedant(db, siteId, { du: "2024-01-01", au: "2026-01-01" })).rejects.toThrow("trop longue");
  });
});

describe("export comptable par tranches : les autres requêtes passent entre deux tranches", () => {
  async function toursPendant(travail: () => Promise<unknown>): Promise<number> {
    let tours = 0;
    let actif = true;
    const concurrent = (async () => {
      while (actif) {
        await new Promise((r) => setImmediate(r));
        tours++;
      }
    })();
    await travail();
    actif = false;
    await concurrent;
    return tours;
  }

  it.each([
    ["journal des ventes", () => exporterJournalVentesCsvCedant(db, siteId, PERIODE, { joursParTranche: 7 })],
    ["journal des encaissements", () => exporterJournalEncaissementsCsvCedant(db, siteId, PERIODE, { joursParTranche: 7 })],
    ["aperçu", () => apercuExportComptableCedant(db, siteId, PERIODE, { joursParTranche: 7 })],
  ])("%s : une pause par tranche (13 tranches de 7 jours)", async (_nom, travail) => {
    expect(await toursPendant(travail)).toBeGreaterThanOrEqual(12);
  });
});
