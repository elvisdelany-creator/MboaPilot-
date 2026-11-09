import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { recruterAbonne } from "../abonnements/recrutement.service.js";
import { creerProduit } from "../produits/produit.repository.js";
import { creerVenteProduits } from "../ventes/vente.service.js";
import { creerAvoir } from "./avoir.service.js";
import { encaisserSoldeFacture } from "./paiement-complementaire.service.js";
import { construireRecuFacture } from "./recu.service.js";

// un client qui a perdu son ticket : le reçu d'une facture déjà encaissée se reconstitue à l'identique (lignes, remise, taxe figée, paiements)
// pour être réimprimé avec la mention DUPLICATA
let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;
let idKit: number;
let idOption: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  idFormule = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
  idKit = db.insert(schema.kit).values({ idFamille: famille.idFamille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", prixParaboleAccessoires: 0 }).returning().get().idKit;
  db.insert(schema.kitPrixDecodeur).values({ idKit, idFormule, prixDecodeur: 5000 }).run();
  idOption = db.insert(schema.optionComplement).values({ libelle: "Option English Plus", prix: 5000 }).returning().get().idOption;
  db.insert(schema.formuleOptionCompat).values({ idFormule, idOption, prixSurcharge: null }).run();
});

const vendre = (lignes: { idProduit: number; quantite: number; remise?: number }[], montantEncaisse: number, idAbonne?: number) =>
  creerVenteProduits(db, { siteId, userId, lignes, montantEncaisse, idAbonne });
// une vente non soldée doit être rattachée à un client
const creerClient = () => db.insert(schema.abonne).values({ siteId, nom: "Nga", prenom: "Paul", telephone: "690000000" }).returning().get().idAbonne;

describe("construireRecuFacture : reçu d'une facture déjà encaissée", () => {
  it("reconstitue les lignes d'une vente de produits, avec la quantité", () => {
    const cable = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, coutRevient: 1000 });
    const prise = creerProduit(db, { siteId, type: "BIEN", libelle: "Prise", prixVente: 1000, coutRevient: 400 });
    const vente = vendre([{ idProduit: cable.idProduit, quantite: 3 }, { idProduit: prise.idProduit, quantite: 1 }], 8500);

    const recu = construireRecuFacture(db, vente.idFacture);

    expect(recu.lignes).toEqual([{ libelle: "Câble HDMI × 3", montant: 7500 }, { libelle: "Prise", montant: 1000 }]);
    expect(recu.total).toBe(8500);
    expect(recu.numeroAbonnement).toBeNull();
    expect(recu.jetonVerification).toBe(db.select().from(schema.facture).where(eq(schema.facture.idFacture, vente.idFacture)).get()!.jetonVerification);
    expect(recu.paiements).toHaveLength(1);
    expect(recu.paiements[0]).toMatchObject({ mode: "CASH", montant: 8500 });
  });

  it("montre le prix catalogue puis la remise : les lignes totalisent toujours le total", () => {
    const cable = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, coutRevient: 1000 });
    const vente = vendre([{ idProduit: cable.idProduit, quantite: 2, remise: 500 }], 4500);

    const recu = construireRecuFacture(db, vente.idFacture);

    expect(recu.lignes).toEqual([{ libelle: "Câble HDMI × 2", montant: 5000 }, { libelle: "Remise — Câble HDMI", montant: -500 }]);
    expect(recu.lignes.reduce((somme, l) => somme + l.montant, 0)).toBe(recu.total);
  });

  it("nomme la formule, le matériel du kit et l'option d'un recrutement, et porte le numéro d'abonnement", () => {
    const r = recruterAbonne(db, {
      siteId, userId, aujourdHui: "2025-11-16", abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
      idFormule, idKit, idsOptions: [idOption], montantEncaisse: 20500,
    });

    const recu = construireRecuFacture(db, r.idFacture);

    expect(recu.numeroAbonnement).toBe(r.numeroAbonnement);
    expect(recu.lignes.map((l) => l.libelle)).toEqual(["EVASION", "KIT CANAL+ GLOBALZ — matériel", "Option English Plus"]);
    expect(recu.lignes.reduce((somme, l) => somme + l.montant, 0)).toBe(recu.total);
  });

  it("liste chaque paiement : un acompte puis le solde apparaissent séparément", () => {
    const cable = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, coutRevient: 1000 });
    const vente = vendre([{ idProduit: cable.idProduit, quantite: 2 }], 2000, creerClient()); // acompte
    encaisserSoldeFacture(db, { idFacture: vente.idFacture, montant: 3000, userId });

    const recu = construireRecuFacture(db, vente.idFacture);

    expect(recu.paiements.map((p) => p.montant)).toEqual([2000, 3000]);
  });

  it("reprend la taxe figée sur la facture, pas le taux courant", () => {
    const cable = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, coutRevient: 1000 });
    const vente = vendre([{ idProduit: cable.idProduit, quantite: 1 }], 2500);
    db.update(schema.facture).set({ montantTaxe: 400 }).where(eq(schema.facture.idFacture, vente.idFacture)).run();

    expect(construireRecuFacture(db, vente.idFacture).montantTaxe).toBe(400);
  });

  it("ignore le remboursement d'un avoir : le reçu d'origine reste celui de la vente", () => {
    const cable = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, coutRevient: 1000 });
    const vente = vendre([{ idProduit: cable.idProduit, quantite: 2 }], 5000);
    const ligne = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, vente.idFacture)).get()!;
    creerAvoir(db, { idFactureOrigine: vente.idFacture, lignes: [{ idLigneOrigine: ligne.idLigne, quantite: 1 }], restituerStock: false, userId, remboursement: { mode: "CASH" } });

    const recu = construireRecuFacture(db, vente.idFacture);

    expect(recu.total).toBe(5000);
    expect(recu.paiements.every((p) => p.montant > 0)).toBe(true);
  });

  it("refuse une facture sans encaissement (brouillon) : elle ne s'imprime jamais", () => {
    const cable = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, coutRevient: 1000 });
    const vente = vendre([{ idProduit: cable.idProduit, quantite: 1 }], 0, creerClient());

    expect(() => construireRecuFacture(db, vente.idFacture)).toThrow(/sans encaissement/);
  });

  it("refuse un avoir : seul le reçu d'une vente se réimprime", () => {
    const cable = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, coutRevient: 1000 });
    const vente = vendre([{ idProduit: cable.idProduit, quantite: 2 }], 5000);
    const ligne = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, vente.idFacture)).get()!;
    const avoir = creerAvoir(db, { idFactureOrigine: vente.idFacture, lignes: [{ idLigneOrigine: ligne.idLigne, quantite: 1 }], restituerStock: false, userId });

    expect(() => construireRecuFacture(db, avoir.idFactureAvoir)).toThrow(/vente/);
  });

  it("signale une facture inconnue", () => {
    expect(() => construireRecuFacture(db, 999999)).toThrow(/introuvable/);
  });
});
