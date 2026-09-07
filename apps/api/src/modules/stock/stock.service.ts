import { and, eq } from "drizzle-orm";
import { calculerCoutMoyenPondere } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { enregistrerMouvement } from "./stock.repository.js";

export interface ReceptionnerAchatParams {
  idProduit: number;
  siteId: number;
  quantite: number;
  coutUnitaire: number;
  userId: number;
}

// 5.2 : réception d'achat — incrémente le stock et recalcule le coût de
// revient en coût moyen pondéré (CUMP) plutôt que de l'écraser par le
// dernier prix d'achat.
export function receptionnerAchat(db: Db, params: ReceptionnerAchatParams) {
  if (params.quantite <= 0) throw new Error("La quantité reçue doit être positive");

  const produitAvant = db.select().from(schema.produit).where(eq(schema.produit.idProduit, params.idProduit)).get();
  if (!produitAvant) throw new Error(`Produit ${params.idProduit} introuvable`);

  const nouveauCout = calculerCoutMoyenPondere(produitAvant.quantiteStock, produitAvant.coutRevient, params.quantite, params.coutUnitaire);

  enregistrerMouvement(db, {
    idProduit: params.idProduit,
    siteId: params.siteId,
    typeMouvement: "ACHAT",
    quantite: params.quantite,
    utilisateurId: params.userId,
  });

  return db
    .update(schema.produit)
    .set({ coutRevient: nouveauCout })
    .where(eq(schema.produit.idProduit, params.idProduit))
    .returning()
    .get();
}

export interface EnregistrerCasseParams {
  idProduit: number;
  siteId: number;
  quantite: number;
  motif: string;
  userId: number;
}

// 5.2 : casse / perte / retour fournisseur — motif obligatoire, non rattaché à une vente
export function enregistrerCasse(db: Db, params: EnregistrerCasseParams) {
  if (!params.motif.trim()) throw new Error("Un motif est obligatoire pour une casse ou une perte");

  return enregistrerMouvement(db, {
    idProduit: params.idProduit,
    siteId: params.siteId,
    typeMouvement: "CASSE",
    quantite: params.quantite,
    motif: params.motif,
    utilisateurId: params.userId,
  });
}

export interface AjusterInventaireParams {
  idProduit: number;
  siteId: number;
  quantiteComptee: number;
  motif: string;
  userId: number;
}

// 5.2 : ajustement d'inventaire — écart constaté vs stock théorique, avec
// justification obligatoire (le rôle habilité à valider est imposé côté
// route via RBAC, pas ici).
export function ajusterInventaire(db: Db, params: AjusterInventaireParams) {
  if (!params.motif.trim()) throw new Error("Un motif est obligatoire pour un ajustement d'inventaire");

  const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, params.idProduit)).get();
  if (!produit) throw new Error(`Produit ${params.idProduit} introuvable`);

  const ecart = params.quantiteComptee - produit.quantiteStock;

  return enregistrerMouvement(db, {
    idProduit: params.idProduit,
    siteId: params.siteId,
    typeMouvement: "INVENTAIRE",
    quantite: ecart,
    motif: params.motif,
    utilisateurId: params.userId,
  });
}

export interface DecrementerComposantsKitParams {
  idKit: number;
  siteId: number;
  userId: number;
}

// 5.1, 5.2 : un kit "produit composé" décrémente automatiquement le stock de
// chacun de ses composants à la vente — un composant sans suivi de stock
// (accessoire non tracé) est simplement ignoré, comme pour une vente directe.
export function decrementerComposantsKit(db: Db, params: DecrementerComposantsKitParams) {
  const composants = db.select().from(schema.kitComposant).where(eq(schema.kitComposant.idKit, params.idKit)).all();

  for (const composant of composants) {
    const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, composant.idProduit)).get();
    if (produit?.suiviStock === 1) {
      enregistrerMouvement(db, {
        idProduit: composant.idProduit,
        siteId: params.siteId,
        typeMouvement: "VENTE",
        quantite: composant.quantite,
        utilisateurId: params.userId,
      });
    }
  }
}

// 8.6, 9.3 : état des stocks du tableau de bord — produits suivis dont le
// stock est descendu au niveau ou en dessous de leur seuil d'alerte.
export function listerAlertesStock(db: Db, siteId: number) {
  return db
    .select()
    .from(schema.produit)
    .where(and(eq(schema.produit.siteId, siteId), eq(schema.produit.suiviStock, 1)))
    .all()
    .filter((p) => p.seuilAlerte !== null && p.quantiteStock <= p.seuilAlerte);
}
