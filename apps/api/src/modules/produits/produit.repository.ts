import { desc, eq } from "drizzle-orm";
import { calculerMarge, type MargeType } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { verifierBooleen, verifierEntier } from "../../lib/validation.js";

// 5.2, 7.3 : catalogue des produits/pièces détachées d'un site
export function listerProduits(db: Db, siteId: number) {
  return db.select().from(schema.produit).where(eq(schema.produit.siteId, siteId)).all();
}

export function trouverProduit(db: Db, idProduit: number) {
  return db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduit)).get();
}

const TYPES_PRODUIT = ["BIEN", "SERVICE", "SAV", "KIT"] as const;
const TYPES_MARGE = ["VALEUR", "POURCENTAGE"] as const;
// plafond d'un prix unitaire : au-delà, les totaux de facture perdent leur précision (entiers sûrs de JS)
const PLAFOND_PRIX_FCFA = 1_000_000_000;

function verifierTexteBorne(valeur: unknown, libelle: string, longueurMax: number) {
  if (valeur === undefined || valeur === null) return;
  if (typeof valeur !== "string") throw new Error(`${libelle} doit être un texte`);
  if (valeur.length > longueurMax) throw new Error(`${libelle} ne peut pas dépasser ${longueurMax} caractères`);
}

// les types TypeScript n'existent pas à l'exécution : une valeur venue de l'API doit être
// vérifiée, sinon un type « PIZZA » ou un suivi de stock "non" (texte = vrai) est enregistré tel quel
function verifierChampsProduit(input: { libelle?: unknown; categorie?: unknown; codeBarres?: unknown; margeType?: unknown; prixVente?: unknown; coutRevient?: unknown }) {
  verifierTexteBorne(input.libelle, "Le libellé de l'article", 200);
  verifierTexteBorne(input.categorie, "La catégorie", 100);
  verifierTexteBorne(input.codeBarres, "Le code-barres", 50);
  if (input.margeType !== undefined && !(TYPES_MARGE as readonly unknown[]).includes(input.margeType)) {
    throw new Error(`Type de marge inconnu — attendu : ${TYPES_MARGE.join(", ")}`);
  }
  verifierEntier(input.prixVente, "Le prix de vente", { max: PLAFOND_PRIX_FCFA, nullable: false });
  verifierEntier(input.coutRevient, "Le coût de revient", { max: PLAFOND_PRIX_FCFA, nullable: false });
}

export interface CreerProduitInput {
  siteId: number;
  type: "BIEN" | "SERVICE" | "SAV" | "KIT";
  libelle: string;
  categorie?: string;
  codeBarres?: string;
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
  if (typeof input.libelle !== "string" || !input.libelle.trim()) throw new Error("Le libellé de l'article est obligatoire");
  if (!(TYPES_PRODUIT as readonly unknown[]).includes(input.type)) throw new Error(`Type d'article inconnu — attendu : ${TYPES_PRODUIT.join(", ")}`);
  verifierBooleen(input.suiviStock, "Le suivi de stock");
  verifierChampsProduit(input);
  // 5.2, 6.1 : un prix de vente négatif se propage tel quel dans les
  // opérations qui l'utilisent directement (échange de matériel, pièce SAV),
  // produisant une facture au montant négatif
  verifierEntier(input.prixVente, "Le prix de vente", { requis: true, nullable: false });
  verifierEntier(input.coutRevient, "Le coût de revient", { nullable: false });
  verifierEntier(input.seuilAlerte, "Le seuil d'alerte");

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
      codeBarres: input.codeBarres,
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
  codeBarres?: string;
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
  // atomique : la ligne d'historique de prix était écrite avant la mise à jour — un échec laissait la trace d'un
  // changement de prix qui n'a pas eu lieu
  return db.transaction(() => modifierProduitSansTransaction(db, idProduit, input));
}

function modifierProduitSansTransaction(db: Db, idProduit: number, input: ModifierProduitInput) {
  const avant = trouverProduit(db, idProduit);
  if (!avant) throw new Error(`Produit ${idProduit} introuvable`);
  if (input.libelle !== undefined && (typeof input.libelle !== "string" || !input.libelle.trim())) throw new Error("Le libellé de l'article est obligatoire");
  verifierChampsProduit(input);
  verifierEntier(input.prixVente, "Le prix de vente", { nullable: false });
  verifierEntier(input.coutRevient, "Le coût de revient", { nullable: false });
  verifierEntier(input.seuilAlerte, "Le seuil d'alerte");

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
      codeBarres: input.codeBarres ?? avant.codeBarres,
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

// 8.2 : "réservé à l'encadrement (données de coût/marge)" — même principe
// que l'export CSV du catalogue (produits.routes.ts), appliqué à la
// consultation du produit brut, ouverte à tout rôle authentifié (caisse, SAV).
const ROLES_ENCADREMENT = ["ADMINISTRATEUR", "GERANT"];

export function estRoleEncadrement(role: string): boolean {
  return ROLES_ENCADREMENT.includes(role);
}

export function masquerCoutMargeProduit<T extends { coutRevient: number; margeValeur: number | null; margePourcentage: number | null }>(produit: T): T {
  return { ...produit, coutRevient: 0, margeValeur: null, margePourcentage: null };
}

export function masquerCoutHistoriquePrix<T extends { coutRevientAvant: number; coutRevientApres: number }>(entree: T): T {
  return { ...entree, coutRevientAvant: 0, coutRevientApres: 0 };
}
