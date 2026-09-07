import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { enregistrerMouvement } from "./stock.repository.js";

export interface TransfererStockParams {
  idProduitSource: number;
  siteDestinationId: number;
  quantite: number;
  motif?: string;
  userId: number;
}

export interface TransfertResultat {
  produitSource: typeof schema.produit.$inferSelect;
  produitDestination: typeof schema.produit.$inferSelect;
}

// 5.2, 8.2 : transfert inter-site — mouvement double (− au site source, + au
// site destination), tracé comme les autres mouvements de stock. Le modèle
// de données rattache chaque article à un site (2.5.2, mode centralisé) : un
// transfert associe l'article du site destination portant le même libellé
// (insensible à la casse/espaces) et le crée en le reprenant de la fiche
// source s'il n'existe pas encore là-bas — un gérant qui déplace un article
// vers une autre boutique ne doit pas d'abord aller le créer manuellement là-bas.
export function transfererStock(db: Db, params: TransfererStockParams): TransfertResultat {
  if (params.quantite <= 0) throw new Error("La quantité transférée doit être positive");

  const source = db.select().from(schema.produit).where(eq(schema.produit.idProduit, params.idProduitSource)).get();
  if (!source) throw new Error(`Produit ${params.idProduitSource} introuvable`);

  const siteDestination = db.select().from(schema.site).where(eq(schema.site.idSite, params.siteDestinationId)).get();
  if (!siteDestination) throw new Error(`Site ${params.siteDestinationId} introuvable`);

  if (source.siteId === params.siteDestinationId) throw new Error("Le site de destination doit être différent du site source");

  let destination = db
    .select()
    .from(schema.produit)
    .where(
      and(
        eq(schema.produit.siteId, params.siteDestinationId),
        eq(schema.produit.type, source.type),
        sql`lower(trim(${schema.produit.libelle})) = lower(trim(${source.libelle}))`
      )
    )
    .get();

  if (!destination) {
    destination = db
      .insert(schema.produit)
      .values({
        siteId: params.siteDestinationId,
        type: source.type,
        libelle: source.libelle,
        categorie: source.categorie,
        prixVente: source.prixVente,
        coutRevient: source.coutRevient,
        margeType: source.margeType,
        margeValeur: source.margeValeur,
        margePourcentage: source.margePourcentage,
        suiviStock: source.suiviStock,
        seuilAlerte: source.seuilAlerte,
      })
      .returning()
      .get();
  }

  const produitSource = enregistrerMouvement(db, {
    idProduit: source.idProduit,
    siteId: source.siteId,
    typeMouvement: "TRANSFERT_SORTIE",
    quantite: params.quantite,
    motif: params.motif,
    utilisateurId: params.userId,
  });

  const produitDestination = enregistrerMouvement(db, {
    idProduit: destination.idProduit,
    siteId: params.siteDestinationId,
    typeMouvement: "TRANSFERT_ENTREE",
    quantite: params.quantite,
    motif: params.motif,
    utilisateurId: params.userId,
  });

  return { produitSource, produitDestination };
}
