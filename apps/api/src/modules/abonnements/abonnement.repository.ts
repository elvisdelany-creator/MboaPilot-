import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

// 4.5, 9.2 : permet à l'écran de caisse de détecter si l'abonné sélectionné a déjà
// un abonnement dans la famille choisie (réabonnement) ou non (recrutement).
export function listerAbonnementsParAbonne(db: Db, idAbonne: number) {
  return db.select().from(schema.abonnement).where(eq(schema.abonnement.idAbonne, idAbonne)).all();
}
