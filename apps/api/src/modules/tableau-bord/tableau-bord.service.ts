import { and, eq, inArray } from "drizzle-orm";
import { genererPlageJours } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { listerAlertesEcheance } from "../jobs/alerte-echeance.repository.js";
import { listerAlertesStock } from "../stock/stock.service.js";

export interface IndicateursJour {
  chiffreAffairesJour: number;
  margeEstimeeJour: number;
  nombreEcheances7j: number;
  nombreAlertesStock: number;
}

// 9.3 : cartons KPI en tête de tableau de bord. La marge est "estimée" (et
// non recalculée historiquement) : elle s'appuie sur la marge courante de
// l'article (6.1), pas sur un instantané au moment de la vente. Les lignes
// d'abonnement/kit ne portent pas de marge dans le modèle actuel (5.1.1 ne
// prévoit pas de coût de revient pour les formules — non tranché ici).
export function calculerIndicateursJour(db: Db, siteId: number, aujourdHui: string): IndicateursJour {
  const facturesJour = db
    .select()
    .from(schema.facture)
    .where(and(eq(schema.facture.siteId, siteId), eq(schema.facture.statut, "VALIDEE")))
    .all()
    .filter((f) => f.dateCreation.slice(0, 10) === aujourdHui);

  const chiffreAffairesJour = facturesJour.reduce((total, f) => total + f.montantTotal, 0);

  const idsFactures = facturesJour.map((f) => f.idFacture);
  const lignes = idsFactures.length > 0 ? db.select().from(schema.ligneVente).where(inArray(schema.ligneVente.idFacture, idsFactures)).all() : [];

  const idsProduits = [...new Set(lignes.filter((l) => l.idProduit !== null).map((l) => l.idProduit as number))];
  const produits = idsProduits.length > 0 ? db.select().from(schema.produit).where(inArray(schema.produit.idProduit, idsProduits)).all() : [];
  const produitParId = new Map(produits.map((p) => [p.idProduit, p]));

  const margeEstimeeJour = lignes.reduce((total, l) => {
    if (l.idProduit === null) return total;
    const produit = produitParId.get(l.idProduit);
    return total + (produit ? (produit.margeValeur ?? 0) * l.quantite : 0);
  }, 0);

  return {
    chiffreAffairesJour,
    margeEstimeeJour,
    nombreEcheances7j: listerAlertesEcheance(db, siteId, aujourdHui).length,
    nombreAlertesStock: listerAlertesStock(db, siteId).length,
  };
}

export interface PointEvolutionCA {
  date: string;
  montant: number;
}

// 9.3 : courbe d'évolution du CA sur une période glissante (7/30 jours)
export function calculerEvolutionCA(db: Db, siteId: number, aujourdHui: string, nombreJours: number): PointEvolutionCA[] {
  const jours = genererPlageJours(aujourdHui, nombreJours);
  const premierJour = jours[0];

  const factures = db
    .select()
    .from(schema.facture)
    .where(and(eq(schema.facture.siteId, siteId), eq(schema.facture.statut, "VALIDEE")))
    .all()
    .filter((f) => f.dateCreation.slice(0, 10) >= premierJour);

  const montantParJour = new Map<string, number>();
  for (const f of factures) {
    const jour = f.dateCreation.slice(0, 10);
    montantParJour.set(jour, (montantParJour.get(jour) ?? 0) + f.montantTotal);
  }

  return jours.map((date) => ({ date, montant: montantParJour.get(date) ?? 0 }));
}

// 8.6 : état des stocks — valorisation au coût de revient
export function calculerValorisationStock(db: Db, siteId: number): number {
  const produits = db
    .select()
    .from(schema.produit)
    .where(and(eq(schema.produit.siteId, siteId), eq(schema.produit.suiviStock, 1)))
    .all();
  return produits.reduce((total, p) => total + p.quantiteStock * p.coutRevient, 0);
}

export interface VentilationPaiement {
  mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";
  total: number;
}

const MODES_PAIEMENT: VentilationPaiement["mode"][] = ["CASH", "CHEQUE", "VIREMENT", "MOBILE_MONEY"];

// 8.6 : encaissements du jour ventilés par mode de paiement
export function listerEncaissementsJour(db: Db, siteId: number, aujourdHui: string): VentilationPaiement[] {
  const lignes = db
    .select({ paiement: schema.paiement })
    .from(schema.paiement)
    .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
    .where(eq(schema.facture.siteId, siteId))
    .all()
    .filter((l) => l.paiement.datePaiement.slice(0, 10) === aujourdHui);

  const totalParMode = new Map<string, number>();
  for (const l of lignes) totalParMode.set(l.paiement.mode, (totalParMode.get(l.paiement.mode) ?? 0) + l.paiement.montant);

  return MODES_PAIEMENT.map((mode) => ({ mode, total: totalParMode.get(mode) ?? 0 }));
}

// 8.6, 6.2 : commissions CANAL+ encore en période probatoire de 4 mois
export function listerCommissionsCanalplusEnCours(db: Db, siteId: number) {
  return db
    .select({ commission: schema.suiviCommissionCanalplus, abonnement: schema.abonnement, abonne: schema.abonne })
    .from(schema.suiviCommissionCanalplus)
    .innerJoin(schema.abonnement, eq(schema.suiviCommissionCanalplus.numeroAbonnement, schema.abonnement.numeroAbonnement))
    .innerJoin(schema.abonne, eq(schema.abonnement.idAbonne, schema.abonne.idAbonne))
    .where(and(eq(schema.abonnement.siteId, siteId), eq(schema.suiviCommissionCanalplus.statut, "EN_COURS")))
    .all();
}
