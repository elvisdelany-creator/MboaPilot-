import { desc, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export type TypeMouvementStock = "ACHAT" | "VENTE" | "CASSE" | "TRANSFERT_ENTREE" | "TRANSFERT_SORTIE" | "INVENTAIRE";

const SIGNE_PAR_TYPE: Record<TypeMouvementStock, 1 | -1> = {
  ACHAT: 1,
  VENTE: -1,
  CASSE: -1,
  TRANSFERT_ENTREE: 1,
  TRANSFERT_SORTIE: -1,
  INVENTAIRE: 1, // non utilisé : la quantité d'un mouvement INVENTAIRE est déjà l'écart signé
};

export interface EnregistrerMouvementParams {
  idProduit: number;
  siteId: number;
  typeMouvement: TypeMouvementStock;
  quantite: number; // magnitude positive, sauf INVENTAIRE où c'est l'écart signé constaté
  motif?: string;
  utilisateurId: number;
}

// 5.2 : point d'entrée unique pour toute variation de stock — journalise le
// mouvement et maintient à jour le cache produit.quantite_stock en un même
// geste, pour que les deux ne puissent jamais diverger.
export function enregistrerMouvement(db: Db, params: EnregistrerMouvementParams) {
  const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, params.idProduit)).get();
  if (!produit) throw new Error(`Produit ${params.idProduit} introuvable`);

  const delta = params.typeMouvement === "INVENTAIRE" ? params.quantite : SIGNE_PAR_TYPE[params.typeMouvement] * params.quantite;

  db.insert(schema.stockMouvement)
    .values({
      idProduit: params.idProduit,
      siteId: params.siteId,
      typeMouvement: params.typeMouvement,
      quantite: params.quantite,
      motif: params.motif,
      utilisateurId: params.utilisateurId,
    })
    .run();

  return db
    .update(schema.produit)
    .set({ quantiteStock: produit.quantiteStock + delta })
    .where(eq(schema.produit.idProduit, params.idProduit))
    .returning()
    .get();
}

export function listerMouvementsProduit(db: Db, idProduit: number) {
  return db
    .select()
    .from(schema.stockMouvement)
    .where(eq(schema.stockMouvement.idProduit, idProduit))
    .orderBy(desc(schema.stockMouvement.idMouvement))
    .all();
}
