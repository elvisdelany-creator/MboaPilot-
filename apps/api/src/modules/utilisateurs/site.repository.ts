import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface CreerSiteInput {
  idEntreprise: number;
  nom: string;
  adresse?: string;
}

// 8.7, 2.5.2 : gestion des sites rattachés à l'entreprise. Le mode retenu en
// V1 est le multi-site centralisé décrit en 2.5.2 (un seul fichier SQLite,
// chaque enregistrement porte un site_id) ; la bascule de supervision entre
// sites pour un rôle multi-boutiques est différée en V2 (12.1).
export function creerSite(db: Db, input: CreerSiteInput) {
  return db.insert(schema.site).values({ idEntreprise: input.idEntreprise, nom: input.nom, adresse: input.adresse }).returning().get();
}

export function trouverSite(db: Db, idSite: number) {
  return db.select().from(schema.site).where(eq(schema.site.idSite, idSite)).get();
}

export function listerSites(db: Db, idEntreprise: number) {
  return db.select().from(schema.site).where(eq(schema.site.idEntreprise, idEntreprise)).all();
}

export interface ModifierSiteInput {
  nom?: string;
  adresse?: string;
  actif?: boolean;
}

export function modifierSite(db: Db, idSite: number, input: ModifierSiteInput) {
  return db
    .update(schema.site)
    .set({
      ...(input.nom !== undefined && { nom: input.nom }),
      ...(input.adresse !== undefined && { adresse: input.adresse }),
      ...(input.actif !== undefined && { actif: input.actif ? 1 : 0 }),
    })
    .where(eq(schema.site.idSite, idSite))
    .returning()
    .get();
}
