import { eq } from "drizzle-orm";
import { JALONS_PAR_DEFAUT, POLITIQUE_MDP_PAR_DEFAUT, type JalonsAlerte, type PolitiqueMotDePasse } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { verifierBooleen, verifierEntier } from "../../lib/validation.js";
import { differencesAudit, journaliserAudit } from "../utilisateurs/audit.repository.js";

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
    dureeRetentionExpiresJours: number;
    politiqueMdpLongueurMin: number;
    politiqueMdpExigerMajuscule: boolean;
    politiqueMdpExigerChiffre: boolean;
    politiqueMdpExigerCaractereSpecial: boolean;
    dureeConservationDonneesJours: number;
    delaiGraceReabonnementJours: number;
    tauxGarantiePourcent: number;
  };
  site: { idSite: number; nom: string; adresse: string | null; imprimanteHote: string | null; imprimantePort: number | null };
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
      dureeRetentionExpiresJours: entreprise.dureeRetentionExpiresJours,
      politiqueMdpLongueurMin: entreprise.politiqueMdpLongueurMin,
      politiqueMdpExigerMajuscule: entreprise.politiqueMdpExigerMajuscule === 1,
      politiqueMdpExigerChiffre: entreprise.politiqueMdpExigerChiffre === 1,
      politiqueMdpExigerCaractereSpecial: entreprise.politiqueMdpExigerCaractereSpecial === 1,
      dureeConservationDonneesJours: entreprise.dureeConservationDonneesJours,
      delaiGraceReabonnementJours: entreprise.delaiGraceReabonnementJours,
      tauxGarantiePourcent: entreprise.tauxGarantiePourcent,
    },
    site: { idSite: site.idSite, nom: site.nom, adresse: site.adresse, imprimanteHote: site.imprimanteHote, imprimantePort: site.imprimantePort },
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

// 3.2.3, 6.1, 8.8 : taux de TVA en vigueur pour le site — lu au moment de la
// création d'une facture pour y figer le montant de taxe correspondant
// (facture.montant_taxe), jamais recalculé après coup si ce taux change.
export function trouverTauxTvaParSite(db: Db, siteId: number): number | null {
  const site = db.select().from(schema.site).where(eq(schema.site.idSite, siteId)).get();
  if (!site) return null;
  const entreprise = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, site.idEntreprise)).get();
  return entreprise?.tauxTva ?? null;
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

const DUREE_RETENTION_EXPIRES_PAR_DEFAUT = 90;

// 4.4, 8.8 : durée (jours) pendant laquelle un abonnement EXPIRE reste
// visible dans la liste dédiée du tableau de bord — la valeur par défaut
// (90 jours) si le site est inconnu, pour la même raison que les jalons d'alerte.
export function trouverDureeRetentionExpiresParSite(db: Db, siteId: number): number {
  const site = db.select().from(schema.site).where(eq(schema.site.idSite, siteId)).get();
  if (!site) return DUREE_RETENTION_EXPIRES_PAR_DEFAUT;
  const entreprise = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, site.idEntreprise)).get();
  return entreprise?.dureeRetentionExpiresJours ?? DUREE_RETENTION_EXPIRES_PAR_DEFAUT;
}

// 11.2, 8.8 : politique de complexité minimale du mot de passe configurée
// pour le site — la politique par défaut (8 caractères, rien d'autre exigé)
// si le site est inconnu, pour la même raison que les jalons d'alerte.
export function trouverPolitiqueMotDePasseParSite(db: Db, siteId: number): PolitiqueMotDePasse {
  const site = db.select().from(schema.site).where(eq(schema.site.idSite, siteId)).get();
  if (!site) return POLITIQUE_MDP_PAR_DEFAUT;
  const entreprise = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, site.idEntreprise)).get();
  if (!entreprise) return POLITIQUE_MDP_PAR_DEFAUT;
  return {
    longueurMin: entreprise.politiqueMdpLongueurMin,
    exigerMajuscule: entreprise.politiqueMdpExigerMajuscule === 1,
    exigerChiffre: entreprise.politiqueMdpExigerChiffre === 1,
    exigerCaractereSpecial: entreprise.politiqueMdpExigerCaractereSpecial === 1,
  };
}

const DUREE_CONSERVATION_DONNEES_PAR_DEFAUT = 1095; // 3 ans

// 11.3, 2.2 : "durée de conservation définie et paramétrable" avant
// anonymisation automatique des abonnés inactifs (job-quotidien.service.ts)
// — mono-entreprise (2.2), même hypothèse que trouverJalonsAlerteEntreprise.
export function trouverDureeConservationDonneesEntreprise(db: Db): number {
  const entreprise = db.select().from(schema.entreprise).get();
  return entreprise?.dureeConservationDonneesJours ?? DUREE_CONSERVATION_DONNEES_PAR_DEFAUT;
}

const DELAI_GRACE_REABONNEMENT_PAR_DEFAUT = 0;

// 4.3, 8.8 : "délai de grâce" de réabonnement — 0 jour par défaut (comportement
// MVP inchangé) ; mono-entreprise (2.2), même hypothèse que
// trouverDureeConservationDonneesEntreprise.
export function trouverDelaiGraceReabonnementEntreprise(db: Db): number {
  const entreprise = db.select().from(schema.entreprise).get();
  return entreprise?.delaiGraceReabonnementJours ?? DELAI_GRACE_REABONNEMENT_PAR_DEFAUT;
}

const TAUX_GARANTIE_PAR_DEFAUT = 0;

// 5.10, 7.3, 8.8 : "sous garantie (gratuit ou tarif réduit selon la
// politique)" — taux appliqué au tarif plein (0 = gratuit par défaut,
// comportement MVP inchangé) ; mono-entreprise (2.2), même hypothèse que
// trouverDelaiGraceReabonnementEntreprise.
export function trouverTauxGarantieEntreprise(db: Db): number {
  const entreprise = db.select().from(schema.entreprise).get();
  return entreprise?.tauxGarantiePourcent ?? TAUX_GARANTIE_PAR_DEFAUT;
}

export interface ModifierEntrepriseInput {
  tauxTva?: number | null;
  mentionsLegales?: string | null;
  tauxCommissionVendeurDefaut?: number | null;
  jalonAlerteUrgent?: number;
  jalonAlerteModere?: number;
  jalonAlerteAnticipe?: number;
  dureeRetentionExpiresJours?: number;
  dureeConservationDonneesJours?: number;
  politiqueMdpLongueurMin?: number;
  politiqueMdpExigerMajuscule?: boolean;
  politiqueMdpExigerChiffre?: boolean;
  politiqueMdpExigerCaractereSpecial?: boolean;
  delaiGraceReabonnementJours?: number;
  tauxGarantiePourcent?: number;
}

// 6.1, 6.2, 4.4, 8.8 : paramétrage des taxes applicables (le cas échéant),
// des mentions légales figurant sur les documents commerciaux (6.7), du
// taux de commission vendeur par défaut et des jalons d'alerte d'échéance
export function modifierEntreprise(db: Db, idEntreprise: number, input: ModifierEntrepriseInput, acteurId: number | null = null) {
  const actuelle = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, idEntreprise)).get();
  if (!actuelle) return undefined;

  // 8.8 : types et bornes de base d'abord (« abc », décimaux, 1e30, null sur une
  // colonne obligatoire) ; les contrôles métier détaillés suivent. Les champs
  // dont la borne basse a son propre message plus bas n'ont ici que le contrôle de type.
  const SANS_BORNE = Number.MIN_SAFE_INTEGER;
  verifierEntier(input.tauxTva, "Le taux de TVA", { max: 10000 });
  verifierEntier(input.tauxCommissionVendeurDefaut, "Le taux de commission vendeur par défaut", { max: 1000 });
  verifierEntier(input.jalonAlerteUrgent, "Le jalon d'alerte urgent", { min: SANS_BORNE, nullable: false });
  verifierEntier(input.jalonAlerteModere, "Le jalon d'alerte modéré", { min: SANS_BORNE, nullable: false });
  verifierEntier(input.jalonAlerteAnticipe, "Le jalon d'alerte anticipé", { min: SANS_BORNE, nullable: false });
  verifierEntier(input.dureeRetentionExpiresJours, "La durée de rétention des abonnements expirés", { min: SANS_BORNE, nullable: false });
  verifierEntier(input.dureeConservationDonneesJours, "La durée de conservation des données", { min: SANS_BORNE, nullable: false });
  verifierEntier(input.politiqueMdpLongueurMin, "La longueur minimale du mot de passe", { min: SANS_BORNE, nullable: false });
  verifierEntier(input.delaiGraceReabonnementJours, "Le délai de grâce de réabonnement", { nullable: false });
  verifierEntier(input.tauxGarantiePourcent, "Le taux de garantie", { min: SANS_BORNE, nullable: false });
  verifierBooleen(input.politiqueMdpExigerMajuscule, "L'exigence de majuscule");
  verifierBooleen(input.politiqueMdpExigerChiffre, "L'exigence de chiffre");
  verifierBooleen(input.politiqueMdpExigerCaractereSpecial, "L'exigence de caractère spécial");
  if (input.mentionsLegales !== undefined && input.mentionsLegales !== null && typeof input.mentionsLegales !== "string") {
    throw new Error("Les mentions légales doivent être un texte");
  }

  const jalonAlerteUrgent = input.jalonAlerteUrgent ?? actuelle.jalonAlerteUrgent;
  const jalonAlerteModere = input.jalonAlerteModere ?? actuelle.jalonAlerteModere;
  const jalonAlerteAnticipe = input.jalonAlerteAnticipe ?? actuelle.jalonAlerteAnticipe;
  if (input.jalonAlerteUrgent !== undefined || input.jalonAlerteModere !== undefined || input.jalonAlerteAnticipe !== undefined) {
    if (jalonAlerteUrgent < 1) throw new Error("Le jalon urgent doit être d'au moins 1 jour");
    if (!(jalonAlerteUrgent < jalonAlerteModere && jalonAlerteModere < jalonAlerteAnticipe)) {
      throw new Error("Les jalons d'alerte doivent être strictement croissants (urgent < modéré < anticipé)");
    }
  }

  if (input.dureeRetentionExpiresJours !== undefined && input.dureeRetentionExpiresJours < 1) {
    throw new Error("La durée de rétention des abonnements expirés doit être d'au moins 1 jour");
  }

  if (input.politiqueMdpLongueurMin !== undefined && input.politiqueMdpLongueurMin < 1) {
    throw new Error("La longueur minimale du mot de passe doit être d'au moins 1 caractère");
  }

  if (input.dureeConservationDonneesJours !== undefined && input.dureeConservationDonneesJours < 1) {
    throw new Error("La durée de conservation des données doit être d'au moins 1 jour");
  }

  if (input.delaiGraceReabonnementJours !== undefined && input.delaiGraceReabonnementJours < 0) {
    throw new Error("Le délai de grâce de réabonnement ne peut pas être négatif");
  }

  if (input.tauxGarantiePourcent !== undefined && (input.tauxGarantiePourcent < 0 || input.tauxGarantiePourcent > 100)) {
    throw new Error("Le taux de garantie doit être compris entre 0 et 100 %");
  }

  // 6.1 : un taux négatif rend le calcul de taxe mathématiquement impossible
  // (division par zéro ou négative dans extraireTaxeDuTTC) — constaté en
  // test grandeur nature : -100 % accepté sans erreur produisait un
  // montant_taxe NULL sur une vraie facture.
  if (input.tauxTva !== undefined && input.tauxTva !== null && input.tauxTva < 0) {
    throw new Error("Le taux de TVA ne peut pas être négatif");
  }

  // 6.2, 8.8 : même garde-fou que côté apporteur (apporteur.repository.ts) —
  // un taux négatif produirait une commission CANAL+ négative, absurde pour
  // un pour-mille de commission.
  if (input.tauxCommissionVendeurDefaut !== undefined && input.tauxCommissionVendeurDefaut !== null && input.tauxCommissionVendeurDefaut < 0) {
    throw new Error("Le taux de commission vendeur par défaut ne peut pas être négatif");
  }

  // 11.5 : valeurs avant/après journalisées (taxes, garantie, jalons, politique de mot de passe…)
  const apres = db
    .update(schema.entreprise)
    .set({
      ...(input.tauxTva !== undefined && { tauxTva: input.tauxTva }),
      ...(input.mentionsLegales !== undefined && { mentionsLegales: input.mentionsLegales }),
      ...(input.tauxCommissionVendeurDefaut !== undefined && { tauxCommissionVendeurDefaut: input.tauxCommissionVendeurDefaut }),
      ...(input.jalonAlerteUrgent !== undefined && { jalonAlerteUrgent }),
      ...(input.jalonAlerteModere !== undefined && { jalonAlerteModere }),
      ...(input.jalonAlerteAnticipe !== undefined && { jalonAlerteAnticipe }),
      ...(input.dureeRetentionExpiresJours !== undefined && { dureeRetentionExpiresJours: input.dureeRetentionExpiresJours }),
      ...(input.dureeConservationDonneesJours !== undefined && { dureeConservationDonneesJours: input.dureeConservationDonneesJours }),
      ...(input.politiqueMdpLongueurMin !== undefined && { politiqueMdpLongueurMin: input.politiqueMdpLongueurMin }),
      ...(input.politiqueMdpExigerMajuscule !== undefined && { politiqueMdpExigerMajuscule: input.politiqueMdpExigerMajuscule ? 1 : 0 }),
      ...(input.politiqueMdpExigerChiffre !== undefined && { politiqueMdpExigerChiffre: input.politiqueMdpExigerChiffre ? 1 : 0 }),
      ...(input.politiqueMdpExigerCaractereSpecial !== undefined && {
        politiqueMdpExigerCaractereSpecial: input.politiqueMdpExigerCaractereSpecial ? 1 : 0,
      }),
      ...(input.delaiGraceReabonnementJours !== undefined && { delaiGraceReabonnementJours: input.delaiGraceReabonnementJours }),
      ...(input.tauxGarantiePourcent !== undefined && { tauxGarantiePourcent: input.tauxGarantiePourcent }),
    })
    .where(eq(schema.entreprise.idEntreprise, idEntreprise))
    .returning()
    .get();

  const diff = differencesAudit(actuelle, apres, CHAMPS_AUDITES_ENTREPRISE);
  if (diff) journaliserAudit(db, { acteurId, action: "MODIFICATION", tableCible: "entreprise", idCible: idEntreprise, ...diff });
  return apres;
}

const CHAMPS_AUDITES_ENTREPRISE = [
  "tauxTva",
  "mentionsLegales",
  "tauxCommissionVendeurDefaut",
  "jalonAlerteUrgent",
  "jalonAlerteModere",
  "jalonAlerteAnticipe",
  "dureeRetentionExpiresJours",
  "dureeConservationDonneesJours",
  "politiqueMdpLongueurMin",
  "politiqueMdpExigerMajuscule",
  "politiqueMdpExigerChiffre",
  "politiqueMdpExigerCaractereSpecial",
  "delaiGraceReabonnementJours",
  "tauxGarantiePourcent",
] as const;
