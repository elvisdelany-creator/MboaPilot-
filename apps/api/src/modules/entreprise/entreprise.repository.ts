import { eq } from "drizzle-orm";
import { JALONS_PAR_DEFAUT, type JalonsAlerte } from "@mboapilot/shared";
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
    jalonAlerteUrgent: number;
    jalonAlerteModere: number;
    jalonAlerteAnticipe: number;
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
      jalonAlerteUrgent: entreprise.jalonAlerteUrgent,
      jalonAlerteModere: entreprise.jalonAlerteModere,
      jalonAlerteAnticipe: entreprise.jalonAlerteAnticipe,
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

// 4.4, 8.8 : jalons d'alerte configurés pour le site — les valeurs par
// défaut (7/3/1) si le site est inconnu, pour que le job quotidien et la
// liste vivante du tableau de bord (9.3) aient toujours un jeu de seuils
// valide sans avoir à se soucier d'un site orphelin.
export function trouverJalonsAlerteParSite(db: Db, siteId: number): JalonsAlerte {
  const site = db.select().from(schema.site).where(eq(schema.site.idSite, siteId)).get();
  if (!site) return JALONS_PAR_DEFAUT;
  const entreprise = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, site.idEntreprise)).get();
  if (!entreprise) return JALONS_PAR_DEFAUT;
  return { urgent: entreprise.jalonAlerteUrgent, modere: entreprise.jalonAlerteModere, anticipe: entreprise.jalonAlerteAnticipe };
}

// 2.2 : mode local — une seule entreprise par installation. Le job quotidien
// (job-quotidien.service.ts) traite les abonnements de tous les sites sans
// filtrer par entreprise ; cette fonction lui donne le seul jeu de jalons
// pertinent dans cette hypothèse mono-entreprise.
export function trouverJalonsAlerteEntreprise(db: Db): JalonsAlerte {
  const entreprise = db.select().from(schema.entreprise).get();
  if (!entreprise) return JALONS_PAR_DEFAUT;
  return { urgent: entreprise.jalonAlerteUrgent, modere: entreprise.jalonAlerteModere, anticipe: entreprise.jalonAlerteAnticipe };
}

export interface ModifierEntrepriseInput {
  tauxTva?: number | null;
  mentionsLegales?: string | null;
  tauxCommissionVendeurDefaut?: number | null;
  jalonAlerteUrgent?: number;
  jalonAlerteModere?: number;
  jalonAlerteAnticipe?: number;
}

// 6.1, 6.2, 4.4, 8.8 : paramétrage des taxes applicables (le cas échéant),
// des mentions légales figurant sur les documents commerciaux (6.7), du
// taux de commission vendeur par défaut et des jalons d'alerte d'échéance
export function modifierEntreprise(db: Db, idEntreprise: number, input: ModifierEntrepriseInput) {
  const actuelle = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, idEntreprise)).get();
  if (!actuelle) return undefined;

  const jalonAlerteUrgent = input.jalonAlerteUrgent ?? actuelle.jalonAlerteUrgent;
  const jalonAlerteModere = input.jalonAlerteModere ?? actuelle.jalonAlerteModere;
  const jalonAlerteAnticipe = input.jalonAlerteAnticipe ?? actuelle.jalonAlerteAnticipe;
  if (input.jalonAlerteUrgent !== undefined || input.jalonAlerteModere !== undefined || input.jalonAlerteAnticipe !== undefined) {
    if (jalonAlerteUrgent < 1) throw new Error("Le jalon urgent doit être d'au moins 1 jour");
    if (!(jalonAlerteUrgent < jalonAlerteModere && jalonAlerteModere < jalonAlerteAnticipe)) {
      throw new Error("Les jalons d'alerte doivent être strictement croissants (urgent < modéré < anticipé)");
    }
  }

  return db
    .update(schema.entreprise)
    .set({
      ...(input.tauxTva !== undefined && { tauxTva: input.tauxTva }),
      ...(input.mentionsLegales !== undefined && { mentionsLegales: input.mentionsLegales }),
      ...(input.tauxCommissionVendeurDefaut !== undefined && { tauxCommissionVendeurDefaut: input.tauxCommissionVendeurDefaut }),
      ...(input.jalonAlerteUrgent !== undefined && { jalonAlerteUrgent }),
      ...(input.jalonAlerteModere !== undefined && { jalonAlerteModere }),
      ...(input.jalonAlerteAnticipe !== undefined && { jalonAlerteAnticipe }),
    })
    .where(eq(schema.entreprise.idEntreprise, idEntreprise))
    .returning()
    .get();
}
