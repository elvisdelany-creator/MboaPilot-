import { eq, sql } from "drizzle-orm";
import { extraireTaxeDuTTC } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { enregistrerMouvement } from "../stock/stock.repository.js";
import { restituerComposantsKit } from "../stock/stock.service.js";
import { trouverTauxTvaParSite } from "../entreprise/entreprise.repository.js";
import { verifierEntier } from "../../lib/validation.js";
import { creerPaiement } from "./paiement.repository.js";

export interface LigneAvoirInput {
  idLigneOrigine: number;
  quantite: number; // quantité à créditer
}

const MODES_REMBOURSEMENT = ["CASH", "CHEQUE", "VIREMENT", "MOBILE_MONEY"] as const;

// Argent rendu au client en même temps que l'avoir. Absent = avoir comptable seul (le remboursement reste à faire).
export interface RemboursementAvoirInput {
  mode: (typeof MODES_REMBOURSEMENT)[number];
  // absent = tout ce qui est dû au client (le montant de l'avoir, dans la limite de ce qui a été payé)
  montant?: number;
}

export interface CreerAvoirParams {
  idFactureOrigine: number;
  lignes: LigneAvoirInput[];
  restituerStock: boolean;
  userId: number;
  remboursement?: RemboursementAvoirInput;
}

export interface AvoirResultat {
  idFactureAvoir: number;
  montantTotal: number; // négatif
  montantTaxe: number; // négatif
  montantRembourse: number; // 0 si aucun remboursement n'a été enregistré avec l'avoir
}

// 6.4, 💡 Conseil d'architecte : correction d'une facture VALIDEE par un avoir
// tracé plutôt qu'une modification directe. Restitution au stock optionnelle
// (une correction tarifaire ne restitue pas un article détérioré) — voir
// enregistrerMouvement / RETOUR_CLIENT. N'ajuste jamais le suivi de
// commission CANAL+ (6.2) ni le cycle de vie de l'abonnement : l'avoir est
// une correction comptable, pas une résiliation.
export function creerAvoir(db: Db, params: CreerAvoirParams): AvoirResultat {
  // atomique : un échec à la restitution de stock laissait une facture d'avoir (et ses lignes) sans mouvement de stock
  return db.transaction(() => creerAvoirSansTransaction(db, params));
}

// quantité d'une ligne encore créditable : ce qui a été facturé moins ce que les avoirs déjà émis en ont repris
function quantiteDisponibleLigne(db: Db, ligne: { idLigne: number; quantite: number }): number {
  const dejaCredite = db
    .select()
    .from(schema.ligneVente)
    .where(eq(schema.ligneVente.ligneOrigineId, ligne.idLigne))
    .all()
    .reduce((somme, l) => somme + l.quantite, 0);
  return ligne.quantite - dejaCredite;
}

// ce que l'utilisateur reconnaît à l'écran : l'article, le kit ou l'abonnement, jamais le numéro de ligne interne
function libelleLigne(db: Db, ligne: { idProduit: number | null; idKit: number | null; numeroAbonnement: number | null }): string {
  if (ligne.idProduit !== null) {
    const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, ligne.idProduit)).get();
    if (produit) return produit.libelle;
  }
  if (ligne.idKit !== null) {
    const kit = db.select().from(schema.kit).where(eq(schema.kit.idKit, ligne.idKit)).get();
    if (kit) return kit.libelle;
  }
  return ligne.numeroAbonnement !== null ? `Abonnement n°${ligne.numeroAbonnement}` : "cette ligne";
}

function creerAvoirSansTransaction(db: Db, params: CreerAvoirParams): AvoirResultat {
  const origine = db.select().from(schema.facture).where(eq(schema.facture.idFacture, params.idFactureOrigine)).get();
  if (!origine) throw new Error(`Facture ${params.idFactureOrigine} introuvable`);
  if (origine.type === "AVOIR") throw new Error("Un avoir ne peut pas lui-même faire l'objet d'un avoir");
  if (origine.statut !== "VALIDEE") throw new Error("Seule une facture VALIDEE peut faire l'objet d'un avoir");
  if (!Array.isArray(params.lignes) || params.lignes.length === 0) throw new Error("Un avoir doit comporter au moins une ligne");

  const lignesAvoir = params.lignes.map((ligneInput) => {
    verifierEntier(ligneInput?.quantite, "La quantité à créditer", { min: 1, requis: true, nullable: false, message: "La quantité à créditer doit être positive" });

    const ligneOrigine = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idLigne, ligneInput.idLigneOrigine)).get();
    if (!ligneOrigine || ligneOrigine.idFacture !== origine.idFacture) {
      throw new Error(`Ligne ${ligneInput.idLigneOrigine} introuvable sur la facture ${origine.idFacture}`);
    }

    const disponible = quantiteDisponibleLigne(db, ligneOrigine);
    if (ligneInput.quantite > disponible) {
      throw new Error(`Quantité à créditer (${ligneInput.quantite}) supérieure à ce qui reste disponible pour « ${libelleLigne(db, ligneOrigine)} » (${disponible})`);
    }

    const prixUnitaire = Math.round(ligneOrigine.prixApplique / ligneOrigine.quantite);
    return {
      ligneOrigineId: ligneOrigine.idLigne,
      idProduit: ligneOrigine.idProduit,
      idKit: ligneOrigine.idKit,
      numeroAbonnement: ligneOrigine.numeroAbonnement,
      quantite: ligneInput.quantite,
      prixApplique: -(prixUnitaire * ligneInput.quantite),
    };
  });

  const montantTotal = lignesAvoir.reduce((somme, l) => somme + l.prixApplique, 0);
  // 3.2.3, 6.1, 8.8 : "porte le total, la TVA/taxes le cas échéant" — négatif,
  // proportionnel au montant crédité, figé au taux en vigueur à cet instant
  const montantTaxe = extraireTaxeDuTTC(montantTotal, trouverTauxTvaParSite(db, origine.siteId));

  const factureAvoir = db
    .insert(schema.facture)
    .values({
      siteId: origine.siteId,
      idAbonne: origine.idAbonne,
      statut: "VALIDEE",
      type: "AVOIR",
      factureOrigineId: origine.idFacture,
      montantTotal,
      montantTaxe,
      creePar: params.userId,
    })
    .returning()
    .get();

  for (const ligne of lignesAvoir) {
    db.insert(schema.ligneVente)
      .values({
        idFacture: factureAvoir.idFacture,
        idProduit: ligne.idProduit,
        idKit: ligne.idKit,
        numeroAbonnement: ligne.numeroAbonnement,
        quantite: ligne.quantite,
        prixApplique: ligne.prixApplique,
        ligneOrigineId: ligne.ligneOrigineId,
      })
      .run();

    if (params.restituerStock && ligne.idKit !== null) {
      restituerComposantsKit(db, { idKit: ligne.idKit, siteId: origine.siteId, userId: params.userId, quantiteKits: ligne.quantite });
    }

    if (params.restituerStock && ligne.idProduit !== null) {
      const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, ligne.idProduit)).get();
      if (produit?.suiviStock === 1) {
        enregistrerMouvement(db, {
          idProduit: ligne.idProduit,
          siteId: origine.siteId,
          typeMouvement: "RETOUR_CLIENT",
          quantite: ligne.quantite,
          utilisateurId: params.userId,
        });
      }
    }
  }

  const montantRembourse = params.remboursement ? enregistrerRemboursement(db, origine, montantTotal, params) : 0;

  return { idFactureAvoir: factureAvoir.idFacture, montantTotal, montantTaxe, montantRembourse };
}

// Le remboursement est un paiement NÉGATIF sur la facture d'origine : il ramène son solde à 0 (le solde négatif d'une
// facture payée puis créditée est précisément « un remboursement dû au client », soldeFacture) et se déduit du
// théorique de la clôture de caisse, par mode de paiement. Plafonné à ce que le client a réellement payé en trop.
function enregistrerRemboursement(db: Db, origine: typeof schema.facture.$inferSelect, montantAvoir: number, params: CreerAvoirParams): number {
  const remboursement = params.remboursement!;
  if (!(MODES_REMBOURSEMENT as readonly string[]).includes(remboursement.mode)) {
    throw new Error(`Mode de remboursement inconnu — attendu : ${MODES_REMBOURSEMENT.join(", ")}`);
  }
  verifierEntier(remboursement.montant, "Le montant remboursé", { min: 1, nullable: false, message: "Le montant remboursé doit être un entier positif en FCFA" });

  const totalPaye = Number(db.select({ total: sql<number>`coalesce(sum(${schema.paiement.montant}), 0)` }).from(schema.paiement).where(eq(schema.paiement.idFacture, origine.idFacture)).get()?.total ?? 0);
  const totalAvoirs = Number(db.select({ total: sql<number>`coalesce(sum(${schema.facture.montantTotal}), 0)` }).from(schema.facture).where(eq(schema.facture.factureOrigineId, origine.idFacture)).get()?.total ?? 0);
  // dû au client après cet avoir (les avoirs précédents et celui-ci sont déjà comptés dans totalAvoirs)
  const remboursable = totalPaye - (origine.montantTotal + totalAvoirs);
  if (remboursable <= 0) {
    throw new Error("Aucun remboursement n'est dû sur cette facture : elle n'a pas été payée ou a déjà été remboursée");
  }

  const montant = remboursement.montant ?? Math.min(-montantAvoir, remboursable);
  if (montant > remboursable) {
    throw new Error(`Le remboursement (${montant}) dépasse ce qui est dû au client sur cette facture (${remboursable})`);
  }

  creerPaiement(db, { idFacture: origine.idFacture, mode: remboursement.mode, montant: -montant, utilisateurId: params.userId });
  return montant;
}

// 6.4 : avoirs déjà émis sur une facture — nécessaire pour calculer le solde
// réellement dû (voir paiement-complementaire.service.ts et sav.routes.ts)
export function listerAvoirsFacture(db: Db, idFacture: number) {
  return db.select().from(schema.facture).where(eq(schema.facture.factureOrigineId, idFacture)).all();
}

// 6.4 : lignes d'une facture, enrichies du libellé de l'article/kit, pour
// choisir quoi créditer lors de l'émission d'un avoir
export function listerLignesFacture(db: Db, idFacture: number) {
  const lignes = db
    .select({
      idLigne: schema.ligneVente.idLigne,
      idProduit: schema.ligneVente.idProduit,
      idKit: schema.ligneVente.idKit,
      numeroAbonnement: schema.ligneVente.numeroAbonnement,
      quantite: schema.ligneVente.quantite,
      prixApplique: schema.ligneVente.prixApplique,
      ligneOrigineId: schema.ligneVente.ligneOrigineId,
      libelleProduit: schema.produit.libelle,
      libelleKit: schema.kit.libelle,
    })
    .from(schema.ligneVente)
    .leftJoin(schema.produit, eq(schema.ligneVente.idProduit, schema.produit.idProduit))
    .leftJoin(schema.kit, eq(schema.ligneVente.idKit, schema.kit.idKit))
    .where(eq(schema.ligneVente.idFacture, idFacture))
    .all();
  // la fenêtre d'avoir doit savoir ce qui a déjà été crédité, sinon elle propose des quantités que le serveur refusera
  return lignes.map((l) => ({ ...l, quantiteDisponible: quantiteDisponibleLigne(db, l) }));
}
