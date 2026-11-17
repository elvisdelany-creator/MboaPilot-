import { eq, sql } from "drizzle-orm";
import { lignesContactBoutique, type EtatImprimable, type SectionEtat } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverInfosEntrepriseParSite } from "../entreprise/entreprise.repository.js";
import {
  facturesDeLaPeriode,
  listerJournalVentes,
  paiementsDeLaPeriode,
  verifierPeriodeExport,
  type LigneJournalVentes,
  type PeriodeExport,
} from "../export-comptable/export-comptable.service.js";
import { creerResolveurFamilleLigne } from "../tableau-bord/tableau-bord.service.js";

// État des ventes (premier des états de gestion) : une période, des sections, des totaux. Toute la logique de calcul est celle de l'application :
// ventes validées de la boutique de la session, jour de Douala, avoirs en négatif, TVA figée sur la facture. Le détail vient du journal des ventes de
// l'export comptable (un seul calcul pour les deux).

export const LIMITE_DETAIL_PAR_DEFAUT = 5000;
const MESSAGE_AUCUNE_VENTE = "Aucune vente sur cette période";

export interface OptionsEtatVentes {
  limiteDetail?: number; // nombre maximal de factures montrées dans le détail
  maintenant?: Date; // instant de génération (injectable pour les tests)
}

// « 5000 » devient « 5 000 » (espace simple : le PDF ne sait pas écrire l'espace insécable fine)
export const espacerMilliers = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

function entete(db: Db, siteId: number): EtatImprimable["entete"] {
  const infos = trouverInfosEntrepriseParSite(db, siteId);
  if (!infos) return { nomBoutique: "Boutique", lignesContact: [] };
  const { entreprise, site } = infos;
  return {
    nomBoutique: entreprise.nom,
    lignesContact: [site.nom, site.adresse ?? "", ...lignesContactBoutique(site)].filter((ligne) => ligne.trim() !== ""),
  };
}

type ChampSomme = "totalTtc" | "taxe" | "totalHt" | "encaisse" | "resteAPayer";
const somme = (journal: LigneJournalVentes[], champ: ChampSomme) => journal.reduce((total, l) => total + l[champ], 0);

function sectionParJour(journal: LigneJournalVentes[]): SectionEtat {
  const parJour = new Map<string, { ventes: number; avoirs: number; ttc: number; tva: number; ht: number }>();
  for (const l of journal) {
    const jour = parJour.get(l.date) ?? { ventes: 0, avoirs: 0, ttc: 0, tva: 0, ht: 0 };
    if (l.type === "AVOIR") jour.avoirs += 1;
    else jour.ventes += 1;
    jour.ttc += l.totalTtc;
    jour.tva += l.taxe;
    jour.ht += l.totalHt;
    parJour.set(l.date, jour);
  }
  const jours = [...parJour.entries()].sort(([a], [b]) => a.localeCompare(b));
  return {
    titre: "Récapitulatif par jour",
    colonnes: [
      { cle: "jour", libelle: "Jour", type: "date", alignement: "gauche" },
      { cle: "ventes", libelle: "Ventes", type: "entier", alignement: "droite" },
      { cle: "avoirs", libelle: "Avoirs", type: "entier", alignement: "droite" },
      { cle: "ttc", libelle: "Total TTC", type: "fcfa", alignement: "droite" },
      { cle: "tva", libelle: "dont TVA", type: "fcfa", alignement: "droite" },
      { cle: "ht", libelle: "Total HT", type: "fcfa", alignement: "droite" },
    ],
    lignes: jours.map(([jour, j]) => [jour, j.ventes, j.avoirs, j.ttc, j.tva, j.ht]),
    totaux: ["Total", somme2(jours, "ventes"), somme2(jours, "avoirs"), somme(journal, "totalTtc"), somme(journal, "taxe"), somme(journal, "totalHt")],
    messageVide: MESSAGE_AUCUNE_VENTE,
  };
}

const somme2 = (jours: [string, { ventes: number; avoirs: number }][], champ: "ventes" | "avoirs") => jours.reduce((total, [, j]) => total + j[champ], 0);

// Chiffre d'affaires par famille : même résolution que le tableau de bord (formule/kit/option → famille d'abonnement ; sinon Produits & Services, SAV).
// Les lignes d'avoir sont en négatif : la somme des familles est bien le total TTC net.
function sectionParFamille(db: Db, siteId: number, periode: PeriodeExport): SectionEtat {
  const lignes = db
    .select({ ligne: schema.ligneVente })
    .from(schema.ligneVente)
    .innerJoin(schema.facture, eq(schema.ligneVente.idFacture, schema.facture.idFacture))
    .where(facturesDeLaPeriode(db, siteId, periode))
    .all();
  const resoudreFamille = creerResolveurFamilleLigne(db);
  const parFamille = new Map<string, number>();
  for (const { ligne } of lignes) {
    const famille = resoudreFamille(ligne);
    parFamille.set(famille, (parFamille.get(famille) ?? 0) + ligne.prixApplique);
  }
  const triees = [...parFamille.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    titre: "Répartition par famille d'activité",
    colonnes: [
      { cle: "famille", libelle: "Famille", type: "texte", alignement: "gauche" },
      { cle: "montant", libelle: "Chiffre d'affaires TTC", type: "fcfa", alignement: "droite" },
    ],
    lignes: triees.map(([famille, montant]) => [famille, montant]),
    totaux: ["Total", triees.reduce((total, [, montant]) => total + montant, 0)],
    messageVide: MESSAGE_AUCUNE_VENTE,
  };
}

const LIBELLES_MODES = { CASH: "Espèces", CHEQUE: "Chèque", VIREMENT: "Virement", MOBILE_MONEY: "Mobile Money" } as const;

// Encaissements de la période par mode, sur la date de chaque paiement (un acompte et son solde tombent chacun dans leur mois) ; un remboursement
// est en négatif. Les quatre modes figurent toujours, à zéro s'il n'y a rien.
function sectionParMode(db: Db, siteId: number, periode: PeriodeExport): { section: SectionEtat; total: number } {
  const paiements = db
    .select({ mode: schema.paiement.mode, total: sql<number>`sum(${schema.paiement.montant})` })
    .from(schema.paiement)
    .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
    .where(paiementsDeLaPeriode(siteId, periode))
    .groupBy(schema.paiement.mode)
    .all();
  const parMode = new Map(paiements.map((p) => [p.mode, p.total]));
  const lignes = (Object.keys(LIBELLES_MODES) as (keyof typeof LIBELLES_MODES)[]).map((mode): [string, number] => [LIBELLES_MODES[mode], parMode.get(mode) ?? 0]);
  const total = lignes.reduce((somme, [, montant]) => somme + montant, 0);
  return {
    total,
    section: {
      titre: "Répartition par mode de paiement",
      colonnes: [
        { cle: "mode", libelle: "Mode de paiement", type: "texte", alignement: "gauche" },
        { cle: "montant", libelle: "Montant", type: "fcfa", alignement: "droite" },
      ],
      lignes,
      totaux: ["Total", total],
    },
  };
}

function sectionDetail(journal: LigneJournalVentes[], limite: number): SectionEtat {
  const tronque = journal.length > limite;
  return {
    titre: "Détail facture par facture",
    colonnes: [
      { cle: "date", libelle: "Date", type: "date", alignement: "gauche" },
      { cle: "numero", libelle: "N°", type: "entier", alignement: "droite" },
      { cle: "type", libelle: "Type", type: "texte", alignement: "gauche", poids: 0.6 },
      { cle: "client", libelle: "Client", type: "texte", alignement: "gauche", poids: 1.3 },
      { cle: "detail", libelle: "Détail", type: "texte", alignement: "gauche", poids: 2 },
      { cle: "ttc", libelle: "Total TTC", type: "fcfa", alignement: "droite" },
      { cle: "encaisse", libelle: "Encaissé", type: "fcfa", alignement: "droite" },
      { cle: "reste", libelle: "Reste à payer", type: "fcfa", alignement: "droite" },
    ],
    lignes: journal.slice(0, limite).map((l) => [l.date, l.idFacture, l.type === "AVOIR" ? "Avoir" : "Vente", l.client, l.detail, l.totalTtc, l.encaisse, l.resteAPayer]),
    // le total d'un détail coupé tromperait : les totaux de la période (section dédiée) restent ceux de toutes les factures
    ...(tronque ? {} : { totaux: ["Total", "", "", "", "", somme(journal, "totalTtc"), somme(journal, "encaisse"), somme(journal, "resteAPayer")] }),
    messageVide: MESSAGE_AUCUNE_VENTE,
  };
}

function sectionTotaux(journal: LigneJournalVentes[], encaisseSurLaPeriode: number): SectionEtat {
  return {
    titre: "Totaux de la période",
    colonnes: [
      { cle: "libelle", libelle: "Libellé", type: "texte", alignement: "gauche" },
      { cle: "montant", libelle: "Montant", type: "fcfa", alignement: "droite" },
    ],
    lignes: [
      ["Total TTC (net des avoirs)", somme(journal, "totalTtc")],
      ["dont TVA", somme(journal, "taxe")],
      ["Total HT", somme(journal, "totalHt")],
      // somme des paiements de la période (par date de paiement) ; le « reste à payer » ci-dessous est, lui, celui d'aujourd'hui sur ces ventes
      ["Encaissé sur la période", encaisseSurLaPeriode],
      ["Reste à payer des ventes de la période", somme(journal, "resteAPayer")],
    ],
  };
}

export function construireEtatVentes(db: Db, siteId: number, periode: PeriodeExport, options: OptionsEtatVentes = {}): EtatImprimable {
  verifierPeriodeExport(periode);
  const limite = options.limiteDetail ?? LIMITE_DETAIL_PAR_DEFAUT;
  const { lignes: journal } = listerJournalVentes(db, siteId, periode);
  const modes = sectionParMode(db, siteId, periode);

  return {
    identifiant: "etat-des-ventes",
    titre: "État des ventes",
    periode: { du: periode.du, au: periode.au },
    entete: entete(db, siteId),
    genereLe: (options.maintenant ?? new Date()).toISOString(),
    sections: [sectionParJour(journal), sectionParFamille(db, siteId, periode), modes.section, sectionDetail(journal, limite), sectionTotaux(journal, modes.total)],
    avertissements: journal.length > limite ? [`Détail limité aux ${espacerMilliers(limite)} premières factures : réduisez la période ou utilisez le CSV.`] : [],
  };
}
