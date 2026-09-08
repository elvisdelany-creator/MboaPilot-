import { and, eq } from "drizzle-orm";
import { calculerCoutMoyenPondere, joursAvantEcheance } from "@mboapilot/shared";
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

export interface ProduitRotationLente {
  produit: typeof schema.produit.$inferSelect;
  derniereVente: string | null; // null si jamais vendu — le cas le plus critique
  joursDepuisDerniereVente: number | null;
}

const SEUIL_ROTATION_LENTE_JOURS = 30;

// 8.6, 9.3 : "État des stocks — produits à rotation lente" — un produit
// suivi, avec du stock disponible, sans vente depuis au moins 30 jours (ou
// jamais vendu), immobilise du capital sans se convertir en chiffre d'affaires.
// Trié du plus critique (jamais vendu, ou invendu depuis le plus longtemps) au moins critique.
export function listerProduitsRotationLente(db: Db, siteId: number, aujourdHui: string): ProduitRotationLente[] {
  const produits = db
    .select()
    .from(schema.produit)
    .where(and(eq(schema.produit.siteId, siteId), eq(schema.produit.suiviStock, 1)))
    .all()
    .filter((p) => p.quantiteStock > 0);

  return produits
    .map((produit) => {
      const ventes = db
        .select()
        .from(schema.stockMouvement)
        .where(and(eq(schema.stockMouvement.idProduit, produit.idProduit), eq(schema.stockMouvement.typeMouvement, "VENTE")))
        .all();
      const derniereVente = ventes.length > 0 ? ventes.map((v) => v.dateMouvement).sort().at(-1)! : null;
      const joursDepuisDerniereVente = derniereVente !== null ? -joursAvantEcheance(derniereVente.slice(0, 10), aujourdHui) : null;
      return { produit, derniereVente, joursDepuisDerniereVente };
    })
    .filter((p) => p.joursDepuisDerniereVente === null || p.joursDepuisDerniereVente >= SEUIL_ROTATION_LENTE_JOURS)
    .sort((a, b) => (b.joursDepuisDerniereVente ?? Infinity) - (a.joursDepuisDerniereVente ?? Infinity));
}
