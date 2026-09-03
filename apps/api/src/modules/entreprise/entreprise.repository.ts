import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface InfosEntreprise {
  entreprise: { idEntreprise: number; nom: string; devise: string; logoUrl: string | null };
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
    entreprise: { idEntreprise: entreprise.idEntreprise, nom: entreprise.nom, devise: entreprise.devise, logoUrl: entreprise.logoUrl },
    site: { idSite: site.idSite, nom: site.nom, adresse: site.adresse },
  };
}
