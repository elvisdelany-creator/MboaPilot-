import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface InfosEntreprise {
  entreprise: {
    idEntreprise: number;
    nom: string;
    devise: string;
    logoUrl: string | null;
    tauxTva: number | null;
    mentionsLegales: string | null;
    tauxCommissionVendeurDefaut: number | null;
  };
  site: { idSite: number; nom: string; adresse: string | null };
}

// 6.7 : identification de l'entreprise/site — en-tête du ticket de caisse,
// de la facture pro-forma et de la facture définitive.
export function trouverInfosEntrepriseParSite(db: Db, siteId: number): InfosEntreprise | undefined {
  const site = db.select().from(schema.site).where(eq(schema.site.idSite, siteId)).get();
  if (!site) return undefined;
  const entreprise = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, site.idEntreprise)).get();
  if (!entreprise) return undefined;

  return {
    entreprise: {
      idEntreprise: entreprise.idEntreprise,
      nom: entreprise.nom,
      devise: entreprise.devise,
      logoUrl: entreprise.logoUrl,
      tauxTva: entreprise.tauxTva,
      mentionsLegales: entreprise.mentionsLegales,
      tauxCommissionVendeurDefaut: entreprise.tauxCommissionVendeurDefaut,
    },
    site: { idSite: site.idSite, nom: site.nom, adresse: site.adresse },
  };
}

// 6.2, 8.8 : taux vendeur par défaut (pour-mille) — utilisé par le
// recrutement CANAL+ (recrutement.service.ts) quand aucun apporteur
// d'affaires référent n'est renseigné ; null si non configuré ou site inconnu.
export function trouverTauxCommissionVendeurParSite(db: Db, siteId: number): number | null {
  const site = db.select().from(schema.site).where(eq(schema.site.idSite, siteId)).get();
  if (!site) return null;
  const entreprise = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, site.idEntreprise)).get();
  return entreprise?.tauxCommissionVendeurDefaut ?? null;
}

export interface ModifierEntrepriseInput {
  tauxTva?: number | null;
  mentionsLegales?: string | null;
  tauxCommissionVendeurDefaut?: number | null;
}

// 6.1, 6.2, 8.8 : paramétrage des taxes applicables (le cas échéant), des
// mentions légales figurant sur les documents commerciaux (6.7) et du taux
// de commission vendeur par défaut
export function modifierEntreprise(db: Db, idEntreprise: number, input: ModifierEntrepriseInput) {
  return db
    .update(schema.entreprise)
    .set({
      ...(input.tauxTva !== undefined && { tauxTva: input.tauxTva }),
      ...(input.mentionsLegales !== undefined && { mentionsLegales: input.mentionsLegales }),
      ...(input.tauxCommissionVendeurDefaut !== undefined && { tauxCommissionVendeurDefaut: input.tauxCommissionVendeurDefaut }),
    })
    .where(eq(schema.entreprise.idEntreprise, idEntreprise))
    .returning()
    .get();
}
