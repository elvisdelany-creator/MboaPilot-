import { desc, eq } from "drizzle-orm";
import { calculerMarge, type MargeType } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

// 5.2, 7.3 : catalogue des produits/pièces détachées d'un site
export function listerProduits(db: Db, siteId: number) {
  return db.select().from(schema.produit).where(eq(schema.produit.siteId, siteId)).all();
}

export function trouverProduit(db: Db, idProduit: number) {
  return db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduit)).get();
}

export interface CreerProduitInput {
  siteId: number;
  type: "BIEN" | "SERVICE" | "SAV" | "KIT";
  libelle: string;
  categorie?: string;
  prixVente: number;
  coutRevient?: number;
  margeType?: MargeType;
  margeValeur?: number;
  margePourcentage?: number;
  suiviStock?: boolean;
  seuilAlerte?: number;
}

// 8.2 : création d'une fiche article — la marge en valeur et en pourcentage
// sont toujours calculées ensemble (6.1), le stock démarre à 0 et ne se
// remplit que par réception d'achat (5.2), jamais saisi directement ici.
export function creerProduit(db: Db, input: CreerProduitInput) {
  const margeType = input.margeType ?? "VALEUR";
  const coutRevient = input.coutRevient ?? 0;
  const marge = calculerMarge({
    margeType,
    coutRevient,
    margeValeur: input.margeValeur ?? null,
    margePourcentage: input.margePourcentage ?? null,
  });

  return db
    .insert(schema.produit)
    .values({
      siteId: input.siteId,
      type: input.type,
      libelle: input.libelle,
      categorie: input.categorie,
      prixVente: input.prixVente,
      coutRevient,
      margeType,
      margeValeur: marge.margeValeur,
      margePourcentage: marge.margePourcentage,
      suiviStock: input.suiviStock ? 1 : 0,
      seuilAlerte: input.seuilAlerte,
    })
    .returning()
    .get();
}

export interface ModifierProduitInput {
  libelle?: string;
  categorie?: string;
  prixVente?: number;
  coutRevient?: number;
  margeType?: MargeType;
  margeValeur?: number;
  margePourcentage?: number;
  seuilAlerte?: number;
  userId: number; // auteur du changement, pour l'historique de prix
}

// 8.2 : édition d'une fiche article — journalise le prix/coût avant-après
// dès que l'un des deux change (historique des variations de prix).
export function modifierProduit(db: Db, idProduit: number, input: ModifierProduitInput) {
  const avant = trouverProduit(db, idProduit);
  if (!avant) throw new Error(`Produit ${idProduit} introuvable`);

  const margeType = input.margeType ?? avant.margeType;
  const coutRevient = input.coutRevient ?? avant.coutRevient;
  const marge = calculerMarge({
    margeType,
    coutRevient,
    margeValeur: input.margeValeur ?? avant.margeValeur,
    margePourcentage: input.margePourcentage ?? avant.margePourcentage,
  });
  const prixVente = input.prixVente ?? avant.prixVente;

  if (prixVente !== avant.prixVente || coutRevient !== avant.coutRevient) {
    db.insert(schema.historiquePrixProduit)
      .values({
        idProduit,
        prixVenteAvant: avant.prixVente,
        prixVenteApres: prixVente,
        coutRevientAvant: avant.coutRevient,
        coutRevientApres: coutRevient,
        utilisateurId: input.userId,
      })
      .run();
  }

  return db
    .update(schema.produit)
    .set({
      libelle: input.libelle ?? avant.libelle,
      categorie: input.categorie ?? avant.categorie,
      prixVente,
      coutRevient,
      margeType,
      margeValeur: marge.margeValeur,
      margePourcentage: marge.margePourcentage,
      seuilAlerte: input.seuilAlerte ?? avant.seuilAlerte,
    })
    .where(eq(schema.produit.idProduit, idProduit))
    .returning()
    .get();
}

export function listerHistoriquePrixProduit(db: Db, idProduit: number) {
  return db
    .select()
    .from(schema.historiquePrixProduit)
    .where(eq(schema.historiquePrixProduit.idProduit, idProduit))
    .orderBy(desc(schema.historiquePrixProduit.idHistoPrix))
    .all();
}
