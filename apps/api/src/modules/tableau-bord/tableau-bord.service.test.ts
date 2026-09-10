import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { genererPlageJours } from "@mboapilot/shared";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { recruterAbonne } from "../abonnements/recrutement.service.js";
import { creerApporteur } from "../apporteurs/apporteur.repository.js";
import { creerProduit } from "../produits/produit.repository.js";
import { receptionnerAchat } from "../stock/stock.service.js";
import { creerVenteProduits } from "../ventes/vente.service.js";
import {
  calculerEvolutionCA,
  calculerIndicateursJour,
  calculerMargeParArticleJour,
  calculerValorisationStock,
  calculerVentilationCAJour,
  listerCommissionsCanalplusEnCours,
  listerEncaissementsJour,
} from "./tableau-bord.service.js";
import * as schema from "../../db/schema.js";

// facture.date_creation est toujours l'horloge réelle de la base
// (datetime('now')), jamais le paramètre aujourdHui injecté dans les
// services métier — les tests doivent donc raisonner sur la vraie date du jour.
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  idFormule = db.insert(schema.formule).values({ idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
});

describe("calculerIndicateursJour (9.3 : cartons KPI)", () => {
  it("cumule le CA et la marge estimée du jour, et compte échéances/alertes de stock", () => {
    recruterAbonne(db, { siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule, montantEncaisse: 10500 });
    const produit = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble", prixVente: 2000, coutRevient: 1000, margeType: "VALEUR", margeValeur: 500, suiviStock: true, seuilAlerte: 5 });
    receptionnerAchat(db, { idProduit: produit.idProduit, siteId, quantite: 2, coutUnitaire: 1000, userId }); // stock 2 <= seuil 5 -> 1 alerte

    const indicateurs = calculerIndicateursJour(db, siteId, AUJOURDHUI);

    expect(indicateurs.chiffreAffairesJour).toBe(10500);
    expect(indicateurs.nombreAlertesStock).toBe(1);
  });

  it("un jour sans facture renvoie des indicateurs à zéro", () => {
    const indicateurs = calculerIndicateursJour(db, siteId, AUJOURDHUI);
    expect(indicateurs).toEqual({ chiffreAffairesJour: 0, margeEstimeeJour: 0, nombreEcheances7j: 0, nombreAlertesStock: 0 });
  });
});

describe("calculerEvolutionCA (9.3 : courbe d'évolution du CA)", () => {
  it("ventile le CA validé par jour sur la période demandée", () => {
    const [avantHier] = genererPlageJours(AUJOURDHUI, 3);

    const r1 = recruterAbonne(db, { siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule, montantEncaisse: 10500 });
    const r2 = recruterAbonne(db, { siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Ada", prenom: "Eve", telephone: "690000001" }, idFormule, montantEncaisse: 10500 });
    // les deux factures sont réellement créées "maintenant" (datetime('now')) —
    // on les antidate manuellement pour simuler une vente il y a deux jours
    db.update(schema.facture).set({ dateCreation: `${avantHier} 10:00:00` }).where(eq(schema.facture.idFacture, r1.idFacture)).run();
    db.update(schema.facture).set({ dateCreation: `${avantHier} 11:00:00` }).where(eq(schema.facture.idFacture, r2.idFacture)).run();

    const evolution = calculerEvolutionCA(db, siteId, AUJOURDHUI, 3);

    expect(evolution.map((p) => p.date)).toEqual(genererPlageJours(AUJOURDHUI, 3));
    expect(evolution[0].montant).toBe(21000);
    expect(evolution[1].montant).toBe(0);
    expect(evolution[2].montant).toBe(0);
  });

  // 9.3 : "filtrable... par famille d'activité" — même logique de résolution
  // de famille que la ventilation du CA du jour (8.6)
  it("filtre la courbe par famille d'activité quand un libellé est fourni", () => {
    const familleDstv = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get();
    const idFormuleDstv = db.insert(schema.formule).values({ idFamille: familleDstv.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 }).returning().get().idFormule;

    recruterAbonne(db, { siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule, montantEncaisse: 10500 });
    recruterAbonne(db, { siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Ada", prenom: "Eve", telephone: "690000001" }, idFormule: idFormuleDstv, montantEncaisse: 13000 });

    const evolutionCanal = calculerEvolutionCA(db, siteId, AUJOURDHUI, 3, "CANAL+");
    expect(evolutionCanal.at(-1)?.montant).toBe(10500);

    const evolutionDstv = calculerEvolutionCA(db, siteId, AUJOURDHUI, 3, "DSTV");
    expect(evolutionDstv.at(-1)?.montant).toBe(13000);

    const evolutionTout = calculerEvolutionCA(db, siteId, AUJOURDHUI, 3);
    expect(evolutionTout.at(-1)?.montant).toBe(23500);
  });
});

describe("calculerValorisationStock (8.6 : état des stocks)", () => {
  it("valorise le stock au coût de revient", () => {
    const produit = creerProduit(db, { siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000, coutRevient: 8000, suiviStock: true });
    receptionnerAchat(db, { idProduit: produit.idProduit, siteId, quantite: 5, coutUnitaire: 8000, userId });

    expect(calculerValorisationStock(db, siteId)).toBe(40000);
  });
});

describe("listerEncaissementsJour (8.6 : ventilation par mode de paiement)", () => {
  it("ventile les encaissements du jour par mode", () => {
    recruterAbonne(db, { siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule, montantEncaisse: 10500 });

    const ventilation = listerEncaissementsJour(db, siteId, AUJOURDHUI);

    expect(ventilation.find((v) => v.mode === "CASH")?.total).toBe(10500);
    expect(ventilation.find((v) => v.mode === "MOBILE_MONEY")?.total).toBe(0);
  });
});

describe("listerCommissionsCanalplusEnCours (8.6, 6.2)", () => {
  it("liste les commissions encore en période probatoire", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur" });
    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: AUJOURDHUI,
      abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
      idFormule,
      montantEncaisse: 10500,
      apporteurId: apporteur.idApporteur,
    });

    const commissions = listerCommissionsCanalplusEnCours(db, siteId);

    expect(commissions).toHaveLength(1);
    expect(commissions[0].commission.statut).toBe("EN_COURS");
    expect(commissions[0].abonne.nom).toBe("Nga");
  });
});

// 8.6 : "Chiffre d'affaires — par famille d'activité (produits, abonnements
// TV, streaming, SAV)"
describe("calculerVentilationCAJour (8.6)", () => {
  it("ventile le CA du jour par famille d'abonnement", () => {
    const dstv = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get();
    const formuleDstv = db.insert(schema.formule).values({ idFamille: dstv.idFamille, libelle: "COMPAQ", prix: 13000, rang: 1 }).returning().get().idFormule;

    recruterAbonne(db, { siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule, montantEncaisse: 10500 });
    recruterAbonne(db, { siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Eyenga", prenom: "Sarah", telephone: "690000001" }, idFormule: formuleDstv, montantEncaisse: 13000 });

    const ventilation = calculerVentilationCAJour(db, siteId, AUJOURDHUI);

    expect(ventilation).toContainEqual({ libelle: "CANAL+", montant: 10500 });
    expect(ventilation).toContainEqual({ libelle: "DSTV", montant: 13000 });
  });

  it("regroupe les biens/services hors SAV sous « Produits & Services », et le SAV séparément", () => {
    const produit = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble", prixVente: 2000, coutRevient: 1000, margeType: "VALEUR", margeValeur: 500 });
    const service = creerProduit(db, { siteId, type: "SERVICE", libelle: "Installation", prixVente: 5000, coutRevient: 0, margeType: "VALEUR", margeValeur: 5000 });
    const piece = creerProduit(db, { siteId, type: "SAV", libelle: "Pièce détachée", prixVente: 3000, coutRevient: 1000, margeType: "VALEUR", margeValeur: 2000 });

    creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: produit.idProduit, quantite: 1 }, { idProduit: service.idProduit, quantite: 1 }], montantEncaisse: 7000 });
    creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit: piece.idProduit, quantite: 1 }], montantEncaisse: 3000 });

    const ventilation = calculerVentilationCAJour(db, siteId, AUJOURDHUI);

    expect(ventilation).toContainEqual({ libelle: "Produits & Services", montant: 7000 });
    expect(ventilation).toContainEqual({ libelle: "SAV", montant: 3000 });
  });

  it("ventile la partie kit d'un recrutement sous la famille du kit", () => {
    const idFamilleCanal = db.select().from(schema.familleAbonnement).where(eq(schema.familleAbonnement.libelle, "CANAL+")).get()!.idFamille;
    const kit = db.insert(schema.kit).values({ idFamille: idFamilleCanal, libelle: "KIT", reglePrix: "PRIX_FIXE", prixFixe: 15000 }).returning().get();

    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: AUJOURDHUI,
      abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
      idFormule,
      idKit: kit.idKit,
      montantEncaisse: 25500,
    });

    const ventilation = calculerVentilationCAJour(db, siteId, AUJOURDHUI);

    expect(ventilation.find((v) => v.libelle === "CANAL+")?.montant).toBe(25500); // 10500 formule + 15000 kit
  });

  it("renvoie une liste vide sans vente", () => {
    expect(calculerVentilationCAJour(db, siteId, AUJOURDHUI)).toEqual([]);
  });
});

// 6.1, 8.6 : "Marge / rentabilité — consolidée à partir du champ gain
// valeur/pourcentage, par famille et par article" — vue par article, seuls
// les produits portant une marge dans le modèle actuel (9.3, non tranché
// pour les formules/kits)
describe("calculerMargeParArticleJour (8.6)", () => {
  it("ventile la marge du jour par article, triée par marge décroissante", () => {
    const cable = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2000, coutRevient: 1000, margeType: "VALEUR", margeValeur: 500 });
    const decodeur = creerProduit(db, {
      siteId,
      type: "BIEN",
      libelle: "Décodeur",
      prixVente: 1200,
      coutRevient: 1000,
      margeType: "POURCENTAGE",
      margePourcentage: 2000, // 20 % -> 200 FCFA/unité
    });
    creerVenteProduits(db, {
      siteId,
      userId,
      lignes: [
        { idProduit: cable.idProduit, quantite: 3 },
        { idProduit: decodeur.idProduit, quantite: 2 },
      ],
      montantEncaisse: 8400,
    });

    const marges = calculerMargeParArticleJour(db, siteId, AUJOURDHUI);

    expect(marges).toEqual([
      { idProduit: cable.idProduit, libelle: "Câble HDMI", quantiteVendue: 3, margeEstimee: 1500 }, // 500 × 3
      { idProduit: decodeur.idProduit, libelle: "Décodeur", quantiteVendue: 2, margeEstimee: 400 }, // 200 × 2
    ]);
  });

  it("ignore les lignes d'abonnement/kit, qui ne portent pas de marge dans le modèle actuel", () => {
    recruterAbonne(db, { siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule, montantEncaisse: 10500 });

    expect(calculerMargeParArticleJour(db, siteId, AUJOURDHUI)).toEqual([]);
  });

  it("renvoie une liste vide sans vente", () => {
    expect(calculerMargeParArticleJour(db, siteId, AUJOURDHUI)).toEqual([]);
  });
});
