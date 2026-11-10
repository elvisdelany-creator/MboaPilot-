import { describe, it, expect } from "vitest";
import { adresseDuVisiteur } from "./adresse-visiteur.js";

// Chaque proxy d'hébergeur AJOUTE à droite de X-Forwarded-For l'adresse qu'il voit, sans retirer ce que le visiteur y a mis : seule la
// droite est fiable, et on ne remonte que d'autant de proxys que l'hébergeur en met. Fastify 5 refuse volontairement de le faire par nombre
// de sauts, donc le calcul est ici.
describe("adresseDuVisiteur", () => {
  it("sans proxy de confiance, ignore l'en-tête : le visiteur ne choisit pas son adresse", () => {
    expect(adresseDuVisiteur({ "x-forwarded-for": "9.9.9.9" }, "10.1.1.1", 0)).toBe("10.1.1.1");
  });

  it("derrière un proxy, retient l'adresse ajoutée par ce proxy (la dernière), pas celles inventées à gauche", () => {
    expect(adresseDuVisiteur({ "x-forwarded-for": "203.0.113.50" }, "10.1.1.1", 1)).toBe("203.0.113.50");
    expect(adresseDuVisiteur({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.50" }, "10.1.1.1", 1)).toBe("203.0.113.50");
  });

  it("derrière deux proxys, remonte de deux crans depuis la droite", () => {
    expect(adresseDuVisiteur({ "x-forwarded-for": "203.0.113.7, 198.51.100.1" }, "10.1.1.1", 2)).toBe("203.0.113.7");
    expect(adresseDuVisiteur({ "x-forwarded-for": "inventée, 203.0.113.7, 198.51.100.1" }, "10.1.1.1", 2)).toBe("203.0.113.7");
  });

  it("sans en-tête (appel direct, sonde de santé), retombe sur l'adresse de la connexion", () => {
    expect(adresseDuVisiteur({}, "10.1.1.1", 1)).toBe("10.1.1.1");
    expect(adresseDuVisiteur({ "x-forwarded-for": "" }, "10.1.1.1", 1)).toBe("10.1.1.1");
  });

  it("si l'en-tête est plus court que le nombre de proxys annoncé, retombe sur l'adresse de la connexion plutôt que de croire une adresse du visiteur", () => {
    expect(adresseDuVisiteur({ "x-forwarded-for": "203.0.113.7" }, "10.1.1.1", 2)).toBe("10.1.1.1");
  });

  it("accepte l'en-tête répété (plusieurs lignes) et les espaces", () => {
    expect(adresseDuVisiteur({ "x-forwarded-for": ["1.1.1.1", " 203.0.113.50 "] }, "10.1.1.1", 1)).toBe("203.0.113.50");
  });
});
