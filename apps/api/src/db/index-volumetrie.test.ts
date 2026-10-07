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
