import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { exporterJournalVentesCsv, listerJournalVentes } from "./export-comptable.service.js";

let db: Db;
let siteId: number;
let userId: number;
let idAbonne: number;
let idProduit: number;
let numeroAbonnement: number;

const PERIODE = { du: "2026-11-01", au: "2026-11-30" };

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555" }).returning().get().idAbonne;
  idProduit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500 }).returning().get().idProduit;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  const idFormule = db.insert(schema.formule).values({ idFamille: famille, libelle: "EVASION", prix: 10500, rang: 3 }).returning().get().idFormule;
  numeroAbonnement = db.insert(schema.abonnement).values({ idAbonne, idFormule, siteId, dateDebut: "2026-11-01", dateFin: "2026-11-30", creePar: userId }).returning().get().numeroAbonnement;
});

function facture(partiel: Partial<typeof schema.facture.$inferInsert> = {}) {
  return db
    .insert(schema.facture)
    .values({ siteId, idAbonne, creePar: userId, statut: "VALIDEE", montantTotal: 11900, montantTaxe: 1900, dateCreation: "2026-11-03 09:00:00", ...partiel })
    .returning()
    .get();
}

describe("listerJournalVentes : les lignes du journal, avant leur mise en forme CSV", () => {
  it("une ligne structurée par facture validée : date, client, détail, TTC, TVA, HT, encaissé, reste dû", () => {
    const f = facture();
    db.insert(schema.ligneVente).values({ idFacture: f.idFacture, numeroAbonnement, prixApplique: 10500 }).run();
    db.insert(schema.ligneVente).values({ idFacture: f.idFacture, idProduit, quantite: 2, prixApplique: 700 }).run();
    db.insert(schema.paiement).values({ idFacture: f.idFacture, mode: "CASH", montant: 10000, utilisateurId: userId, datePaiement: "2026-11-03 09:05:00" }).run();

    const { lignes } = listerJournalVentes(db, siteId, PERIODE);

    expect(lignes).toEqual([
      {
        idFacture: f.idFacture,
        date: "2026-11-03",
        type: "VENTE",
        factureOrigineId: null,
        idAbonne,
        client: "Marie Ngo",
        detail: "1 × EVASION + 2 × Câble HDMI",
        totalTtc: 11900,
        taxe: 1900,
        totalHt: 10000,
        encaisse: 10000,
        resteAPayer: 1900,
      },
    ]);
  });

  it("la date est celle de Douala : une vente à 23 h 30 UTC appartient au jour suivant", () => {
    facture({ dateCreation: "2026-11-03 23:30:00" });

    expect(listerJournalVentes(db, siteId, PERIODE).lignes[0].date).toBe("2026-11-04");
  });

  it("un avoir est une ligne en négatif, sans reste à payer, qui renvoie à sa facture d'origine", () => {
    const vente = facture();
    const avoir = facture({ type: "AVOIR", factureOrigineId: vente.idFacture, montantTotal: -2500, montantTaxe: 0, dateCreation: "2026-11-04 10:00:00" });

    const lignes = listerJournalVentes(db, siteId, PERIODE).lignes;

    expect(lignes.map((l) => [l.idFacture, l.type, l.totalTtc, l.resteAPayer])).toEqual([
      [vente.idFacture, "VENTE", 11900, 11900 - 2500], // le reste d'une vente tient compte de son avoir
      [avoir.idFacture, "AVOIR", -2500, 0],
    ]);
    expect(lignes[1].factureOrigineId).toBe(vente.idFacture);
  });

  it("le CSV de l'export comptable en est exactement la mise en forme : même nombre de lignes", () => {
    facture();
    facture({ dateCreation: "2026-11-05 10:00:00" });

    const { lignes } = listerJournalVentes(db, siteId, PERIODE);
    const { nombre, csv } = exporterJournalVentesCsv(db, siteId, PERIODE);

    expect(nombre).toBe(lignes.length);
    expect(csv.split("\r\n")).toHaveLength(lignes.length + 1);
  });
});
