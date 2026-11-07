import { describe, expect, it } from "vitest";
import { DUREE_BROUILLON_CAISSE_MS, brouillonCaisseEstVide, lireBrouillonCaisse, serialiserBrouillonCaisse, type BrouillonCaisse } from "./brouillon-caisse.js";

const MAINTENANT = Date.UTC(2026, 10, 7, 10, 0, 0);

const vide: BrouillonCaisse = { abonne: null, idFamille: null, idFormule: null, idKit: null, idsOptions: [], numeroSerie: "", remise: 0, modeProduits: false, lignes: [] };
const brouillon = (partiel: Partial<BrouillonCaisse>): BrouillonCaisse => ({ ...vide, ...partiel });

// Constaté en test grandeur nature : le caissier construit un ticket (2 câbles, 5 000 FCFA), va consulter un client dans « Clients »,
// revient à la caisse — le ticket a disparu. Un rechargement de la page fait pareil. Le brouillon survit à l'un et à l'autre, sans
// jamais ressusciter une vente périmée ni se laisser tromper par un stockage corrompu.
describe("brouillonCaisseEstVide", () => {
  it("un ticket sans client, formule, kit, option, ligne, série ni remise est vide", () => {
    expect(brouillonCaisseEstVide(vide)).toBe(true);
  });

  it("choisir seulement une famille ou le mode produits ne fait pas un brouillon à garder", () => {
    expect(brouillonCaisseEstVide(brouillon({ idFamille: 3, modeProduits: true }))).toBe(true);
  });

  it.each([
    ["un client", brouillon({ abonne: { nom: "Ngo", prenom: "Paul", telephone: "677000555" } })],
    ["une formule", brouillon({ idFormule: 3 })],
    ["un kit", brouillon({ idKit: 1 })],
    ["une option", brouillon({ idsOptions: [2] })],
    ["une ligne", brouillon({ lignes: [{ idProduit: 1, quantite: 2, remise: 0 }] })],
    ["un numéro de série", brouillon({ numeroSerie: "SN-1" })],
    ["une remise", brouillon({ remise: 500 })],
  ])("%s suffit à faire un brouillon", (_nom, b) => {
    expect(brouillonCaisseEstVide(b)).toBe(false);
  });
});

describe("serialiserBrouillonCaisse / lireBrouillonCaisse", () => {
  const complet = brouillon({
    abonne: { idAbonne: 7, nom: "Ngo", prenom: "Paul", telephone: "677000555", siteId: 1, email: null },
    idFamille: 1,
    idFormule: 3,
    idKit: 2,
    idsOptions: [1, 4],
    numeroSerie: "SN-123",
    remise: 500,
    modeProduits: false,
    lignes: [{ idProduit: 5, quantite: 2, remise: 100 }],
  });

  it("restitue exactement ce qui a été enregistré, y compris la fiche complète du client", () => {
    const brut = serialiserBrouillonCaisse(complet, MAINTENANT);

    expect(lireBrouillonCaisse(brut, MAINTENANT + 60_000)).toEqual(complet);
  });

  it("n'enregistre rien pour un ticket vide : l'appelant efface alors le brouillon", () => {
    expect(serialiserBrouillonCaisse(vide, MAINTENANT)).toBeNull();
  });

  it("ne restitue rien quand il n'y a rien d'enregistré", () => {
    expect(lireBrouillonCaisse(null, MAINTENANT)).toBeNull();
    expect(lireBrouillonCaisse("", MAINTENANT)).toBeNull();
  });

  it("oublie un brouillon plus vieux que la durée de garde : une vente d'hier ne revient pas ce matin", () => {
    const brut = serialiserBrouillonCaisse(complet, MAINTENANT);

    expect(lireBrouillonCaisse(brut, MAINTENANT + DUREE_BROUILLON_CAISSE_MS - 1000)).not.toBeNull();
    expect(lireBrouillonCaisse(brut, MAINTENANT + DUREE_BROUILLON_CAISSE_MS + 1000)).toBeNull();
  });

  it("oublie un brouillon daté du futur (horloge déréglée ou stockage trafiqué)", () => {
    const brut = serialiserBrouillonCaisse(complet, MAINTENANT + 3 * 3_600_000);

    expect(lireBrouillonCaisse(brut, MAINTENANT)).toBeNull();
  });

  it.each([
    ["du texte quelconque", "pas du json"],
    ["un tableau", "[1,2]"],
    ["un nombre", "42"],
    ["une version inconnue", JSON.stringify({ v: 99, enregistreLe: MAINTENANT, brouillon: complet })],
    ["une date absente", JSON.stringify({ v: 1, brouillon: complet })],
    ["un brouillon absent", JSON.stringify({ v: 1, enregistreLe: MAINTENANT })],
  ])("ignore un stockage corrompu : %s", (_nom, brut) => {
    expect(lireBrouillonCaisse(brut, MAINTENANT)).toBeNull();
  });

  const enveloppe = (b: unknown) => JSON.stringify({ v: 1, enregistreLe: MAINTENANT, brouillon: b });

  it.each([
    ["une quantité nulle", { ...complet, lignes: [{ idProduit: 5, quantite: 0, remise: 0 }] }],
    ["une quantité décimale", { ...complet, lignes: [{ idProduit: 5, quantite: 1.5, remise: 0 }] }],
    ["une quantité démesurée", { ...complet, lignes: [{ idProduit: 5, quantite: 100000, remise: 0 }] }],
    ["un produit sans identifiant", { ...complet, lignes: [{ quantite: 1, remise: 0 }] }],
    ["une remise de ligne négative", { ...complet, lignes: [{ idProduit: 5, quantite: 1, remise: -5 }] }],
    ["une remise négative", { ...complet, remise: -1 }],
    ["des options qui ne sont pas des nombres", { ...complet, idsOptions: ["a"] }],
    ["un client sans nom", { ...complet, abonne: { prenom: "Paul", telephone: "677000555" } }],
    ["un numéro de série démesuré", { ...complet, numeroSerie: "x".repeat(500) }],
    ["un mode produits non booléen", { ...complet, modeProduits: "oui" }],
    ["une formule décimale", { ...complet, idFormule: 3.5 }],
  ])("refuse un brouillon avec %s plutôt que de remplir la caisse de valeurs impossibles", (_nom, b) => {
    expect(lireBrouillonCaisse(enveloppe(b), MAINTENANT)).toBeNull();
  });
});
