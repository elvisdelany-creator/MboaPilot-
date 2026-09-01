import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

// 5.2, 7.3 : catalogue des produits/pièces détachées d'un site
export function listerProduits(db: Db, siteId: number) {
  return db.select().from(schema.produit).where(eq(schema.produit.siteId, siteId)).all();
}
