import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { enregistrerMouvement } from "../stock/stock.repository.js";

export interface LigneAvoirInput {
  idLigneOrigine: number;
  quantite: number; // quantité à créditer
}

export interface CreerAvoirParams {
  idFactureOrigine: number;
  lignes: LigneAvoirInput[];
  restituerStock: boolean;
  userId: number;
}

export interface AvoirResultat {
  idFactureAvoir: number;
  montantTotal: number; // négatif
}

// 6.4, 💡 Conseil d'architecte : correction d'une facture VALIDEE par un avoir
// tracé plutôt qu'une modification directe. Restitution au stock optionnelle
// (une correction tarifaire ne restitue pas un article détérioré) — voir
// enregistrerMouvement / RETOUR_CLIENT. N'ajuste jamais le suivi de
// commission CANAL+ (6.2) ni le cycle de vie de l'abonnement : l'avoir est
// une correction comptable, pas une résiliation.
export function creerAvoir(db: Db, params: CreerAvoirParams): AvoirResultat {
  const origine = db.select().from(schema.facture).where(eq(schema.facture.idFacture, params.idFactureOrigine)).get();
  if (!origine) throw new Error(`Facture ${params.idFactureOrigine} introuvable`);
  if (origine.type === "AVOIR") throw new Error("Un avoir ne peut pas lui-même faire l'objet d'un avoir");
  if (origine.statut !== "VALIDEE") throw new Error("Seule une facture VALIDEE peut faire l'objet d'un avoir");
  if (params.lignes.length === 0) throw new Error("Un avoir doit comporter au moins une ligne");

  const lignesAvoir = params.lignes.map((ligneInput) => {
    if (ligneInput.quantite <= 0) throw new Error("La quantité à créditer doit être positive");

    const ligneOrigine = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idLigne, ligneInput.idLigneOrigine)).get();
    if (!ligneOrigine || ligneOrigine.idFacture !== origine.idFacture) {
      throw new Error(`Ligne ${ligneInput.idLigneOrigine} introuvable sur la facture ${origine.idFacture}`);
    }

    const dejaCredite = db
      .select()
      .from(schema.ligneVente)
      .where(eq(schema.ligneVente.ligneOrigineId, ligneOrigine.idLigne))
      .all()
      .reduce((somme, l) => somme + l.quantite, 0);
    const disponible = ligneOrigine.quantite - dejaCredite;
    if (ligneInput.quantite > disponible) {
      throw new Error(`Quantité à créditer (${ligneInput.quantite}) supérieure à ce qui reste disponible sur la ligne ${ligneOrigine.idLigne} (${disponible})`);
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

  const factureAvoir = db
    .insert(schema.facture)
    .values({
      siteId: origine.siteId,
      idAbonne: origine.idAbonne,
      statut: "VALIDEE",
      type: "AVOIR",
      factureOrigineId: origine.idFacture,
      montantTotal,
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

  return { idFactureAvoir: factureAvoir.idFacture, montantTotal };
}

// 6.4 : lignes d'une facture, enrichies du libellé de l'article/kit, pour
// choisir quoi créditer lors de l'émission d'un avoir
export function listerLignesFacture(db: Db, idFacture: number) {
  return db
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
}
