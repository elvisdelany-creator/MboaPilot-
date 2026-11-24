import { describe, it, expect } from "vitest";
import { creerDbTest } from "../test-utils/db.js";

// 11.1 : « ≥ 50 000 abonnés actifs et 500 000 lignes de vente sans dégradation
// perceptible » — constaté en test grandeur nature : sans index sur facture,
// ligne_vente et paiement, chaque écran du tableau de bord relisait toute la
// table (1 à 2 s pour 150 000 factures).
function colonnesIndexees(table: string): string[] {
  const db = creerDbTest();
  const index = db.all<{ name: string }>(`PRAGMA index_list('${table}')` as never);
  return index.map((i) => (db.all<{ name: string }>(`PRAGMA index_info('${i.name}')` as never).map((c) => c.name).join(",")));
}

describe("index de volumétrie (11.1)", () => {
  it("facture : indexée par site, statut et date de création", () => {
    expect(colonnesIndexees("facture")).toContain("site_id,statut,date_creation");
  });

  it("ligne_vente : indexée par facture", () => {
    expect(colonnesIndexees("ligne_vente")).toContain("id_facture");
  });

  it("paiement : indexé par facture et par date de paiement", () => {
    const index = colonnesIndexees("paiement");
    expect(index).toContain("id_facture");
    expect(index).toContain("date_paiement");
  });

  it("abonnement : indexé par site, statut et date de fin", () => {
    expect(colonnesIndexees("abonnement")).toContain("site_id,statut,date_fin");
  });
});

// Test grandeur nature à 50 000 abonnés, 200 000 factures et 200 000 mouvements de stock : l'écran « rotation lente » prenait 83 secondes et
// bloquait toute la boutique, « ventes en attente » 8 secondes. Chaque article ou chaque facture relisait une table entière, faute d'index
// sur la colonne qui les relie.
describe("index des colonnes de liaison (volumétrie, suite)", () => {
  it.each([
    ["stock_mouvement", "id_produit,type_mouvement,date_mouvement"], // mouvements d'un article, dernière vente et dernière réception
    ["sav_dossier", "id_facture"], // un dossier SAV déjà facturé
    ["sav_dossier", "id_abonne"], // dossiers d'un client
    ["transaction_mobile_money", "id_facture"], // paiement mobile en cours sur une vente
    ["historique_abonnement", "numero_abonnement"], // historique d'un abonnement
    ["ligne_vente", "numero_abonnement"], // lignes qui touchent un abonnement
    ["suivi_commission_canalplus", "numero_abonnement"],
    ["materiel_abonne", "numero_abonnement"],
    ["facture", "id_abonne"], // fiche client : toutes ses factures
    ["facture", "facture_origine_id"], // avoirs d'une vente : sans lui, chaque tranche d'un état relit toute la table des factures
    ["notification", "id_abonne"], // fiche client : ses notifications
  ])("%s : indexée par %s", (table, colonnes) => {
    expect(colonnesIndexees(table)).toContain(colonnes);
  });
});
