import { describe, it, expect } from "vitest";
import { classerEncaissement } from "./etat-encaissement.js";

// 6.4 : « dès qu'un encaissement, même partiel, est enregistré, la facture passe à VALIDÉE » : le statut ne dit donc pas si la vente
// est soldée. Le message de fin de vente doit le dire, sinon un acompte passe pour un règlement complet.
describe("classerEncaissement", () => {
  it("montant égal au total : encaissement total", () => {
    expect(classerEncaissement(10500, 10500, "VALIDEE")).toEqual({ type: "TOTAL" });
  });

  it("montant supérieur au total (monnaie rendue) : encaissement total", () => {
    expect(classerEncaissement(10500, 11000, "VALIDEE")).toEqual({ type: "TOTAL" });
  });

  it("acompte : partiel, avec le montant encaissé et le reste dû", () => {
    expect(classerEncaissement(5000, 3000, "VALIDEE")).toEqual({ type: "PARTIEL", encaisse: 3000, reste: 2000 });
  });

  it("facture non validée (rien encaissé) : en attente", () => {
    expect(classerEncaissement(5000, 0, "BROUILLON")).toEqual({ type: "ATTENTE" });
  });

  it("facture validée mais montant nul : en attente d'encaissement, jamais « encaissée »", () => {
    expect(classerEncaissement(5000, 0, "VALIDEE")).toEqual({ type: "ATTENTE" });
  });

  it("total nul (rien à encaisser, par exemple une vente intégralement remisée) : total", () => {
    expect(classerEncaissement(0, 0, "VALIDEE")).toEqual({ type: "TOTAL" });
  });
});
