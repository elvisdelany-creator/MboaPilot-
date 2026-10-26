import { describe, expect, it } from "vitest";
import { messageStockInsuffisant, peutAjouterAuPanier } from "./stock-vendable.js";

// 5.2 : un stock ne descend jamais sous zéro ; la caisse n'offre donc pas de vendre plus que le disponible.
describe("peutAjouterAuPanier", () => {
  it("autorise tant que le panier reste dans le stock", () => {
    expect(peutAjouterAuPanier({ suiviStock: 1, quantiteStock: 3 }, 0)).toBe(true);
    expect(peutAjouterAuPanier({ suiviStock: 1, quantiteStock: 3 }, 2)).toBe(true);
  });

  it("refuse dès que le panier atteint le stock", () => {
    expect(peutAjouterAuPanier({ suiviStock: 1, quantiteStock: 3 }, 3)).toBe(false);
    expect(peutAjouterAuPanier({ suiviStock: 1, quantiteStock: 0 }, 0)).toBe(false);
  });

  it("n'impose aucune limite à un article dont le stock n'est pas suivi (service)", () => {
    expect(peutAjouterAuPanier({ suiviStock: 0, quantiteStock: 0 }, 50)).toBe(true);
  });
});

describe("messageStockInsuffisant", () => {
  it("nomme l'article et le disponible", () => {
    expect(messageStockInsuffisant("Câble HDMI", 3)).toBe("Stock insuffisant pour « Câble HDMI » : 3 disponible(s).");
    expect(messageStockInsuffisant("Câble HDMI", 0)).toBe("« Câble HDMI » est en rupture de stock.");
  });
});
