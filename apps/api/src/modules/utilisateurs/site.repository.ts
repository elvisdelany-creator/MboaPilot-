import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { verifierEntier } from "../../lib/validation.js";

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
  if (!input.nom.trim()) throw new Error("Le nom du site est obligatoire");

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
  // 11.4, 6.7 : "Compatibilité imprimante thermique 80mm (protocole
  // ESC/POS)" — chaîne vide pour imprimanteHote efface la configuration
  // (retour au repli sur l'impression navigateur, impression.service.ts)
  imprimanteHote?: string;
  imprimantePort?: number;
}

export function modifierSite(db: Db, idSite: number, input: ModifierSiteInput) {
  // 8.7 : même garde-fou qu'à la création (creerSite) — le nom du site est
  // affiché partout (en-tête, reçus, sélecteurs de site).
  if (input.nom !== undefined && (typeof input.nom !== "string" || !input.nom.trim())) throw new Error("Le nom du site est obligatoire");
  if (input.adresse !== undefined && input.adresse !== null && typeof input.adresse !== "string") throw new Error("L'adresse du site doit être un texte");
  if (input.actif !== undefined && typeof input.actif !== "boolean") throw new Error("Le champ actif doit être vrai ou faux");
  if (input.imprimanteHote !== undefined && typeof input.imprimanteHote !== "string") throw new Error("L'hôte de l'imprimante doit être un texte");
  verifierEntier(input.imprimantePort, "Le port de l'imprimante", { min: 1, max: 65535, nullable: false });

  const efface = input.imprimanteHote === "";
  return db
    .update(schema.site)
    .set({
      ...(input.nom !== undefined && { nom: input.nom }),
      ...(input.adresse !== undefined && { adresse: input.adresse }),
      ...(input.actif !== undefined && { actif: input.actif ? 1 : 0 }),
      ...(efface && { imprimanteHote: null, imprimantePort: null }),
      ...(!efface && input.imprimanteHote !== undefined && { imprimanteHote: input.imprimanteHote }),
      ...(!efface && input.imprimantePort !== undefined && { imprimantePort: input.imprimantePort }),
    })
    .where(eq(schema.site.idSite, idSite))
    .returning()
    .get();
}
