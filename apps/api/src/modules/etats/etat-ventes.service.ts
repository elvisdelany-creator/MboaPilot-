import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { decalerJour, joursAvantEcheance, lignesContactBoutique, type EtatImprimable, type SectionEtat } from "@mboapilot/shared";
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
import { LIBELLE_AUTRE, LIBELLE_PRODUITS_SERVICES, LIBELLE_SAV } from "../tableau-bord/tableau-bord.service.js";
import { cederLaMain } from "../../lib/ceder-la-main.js";

// État des ventes (premier des états de gestion) : une période, des sections, des totaux. Toute la logique de calcul est celle de l'application :
// ventes validées de la boutique de la session, jour de Douala, avoirs en négatif, TVA figée sur la facture. Le détail vient du journal des ventes de
// l'export comptable (un seul calcul pour les deux).

export const LIMITE_DETAIL_PAR_DEFAUT = 5000;
const MESSAGE_AUCUNE_VENTE = "Aucune vente sur cette période";

export interface OptionsEtatVentes {
  limiteDetail?: number; // nombre maximal de factures montrées dans le détail
  maintenant?: Date; // instant de génération (injectable pour les tests)
  joursParTranche?: number; // construireEtatVentesCedant : taille des tranches de calcul, en jours (par défaut : selon le volume de la période)
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
// Une seule requête groupée, qui applique les règles du résolveur du tableau de bord dans l'ordre : facture d'un dossier SAV, famille de l'abonnement de
// la ligne, famille de son kit, article SAV ou autre article, sinon « Autre ». Retrouver la famille de chaque article et de chaque abonnement par des
// requêtes une à une, refaites à chaque tranche, prenait plus de la moitié des 23 secondes d'un état sur un an de ventes à 100 000 factures.
export function repartitionFamilles(db: Db, siteId: number, periode: PeriodeExport): Map<string, number> {
  const familleAbonnement = alias(schema.familleAbonnement, "famille_de_l_abonnement");
  const familleKit = alias(schema.familleAbonnement, "famille_du_kit");
  const libelle = sql<string>`coalesce(
    case when exists (select 1 from ${schema.savDossier} where ${schema.savDossier.idFacture} = ${schema.ligneVente.idFacture}) then ${LIBELLE_SAV} end,
    ${familleAbonnement.libelle},
    ${familleKit.libelle},
    case when ${schema.ligneVente.idProduit} is not null then (case when ${schema.produit.type} = 'SAV' then ${LIBELLE_SAV} else ${LIBELLE_PRODUITS_SERVICES} end) end,
    ${LIBELLE_AUTRE}
  )`;
  const lignes = db
    .select({ libelle, montant: sql<number>`sum(${schema.ligneVente.prixApplique})` })
    .from(schema.ligneVente)
    .innerJoin(schema.facture, eq(schema.ligneVente.idFacture, schema.facture.idFacture))
    .leftJoin(schema.abonnement, eq(schema.ligneVente.numeroAbonnement, schema.abonnement.numeroAbonnement))
    .leftJoin(schema.formule, eq(schema.abonnement.idFormule, schema.formule.idFormule))
    .leftJoin(familleAbonnement, eq(schema.formule.idFamille, familleAbonnement.idFamille))
    .leftJoin(schema.kit, eq(schema.ligneVente.idKit, schema.kit.idKit))
    .leftJoin(familleKit, eq(schema.kit.idFamille, familleKit.idFamille))
    .leftJoin(schema.produit, eq(schema.ligneVente.idProduit, schema.produit.idProduit))
    .where(facturesDeLaPeriode(db, siteId, periode))
    .groupBy(libelle)
    .all();
  return new Map(lignes.map((l) => [l.libelle, l.montant]));
}

function sectionParFamille(parFamille: Map<string, number>): SectionEtat {
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
function encaissementsParMode(db: Db, siteId: number, periode: PeriodeExport): Map<string, number> {
  const paiements = db
    .select({ mode: schema.paiement.mode, total: sql<number>`sum(${schema.paiement.montant})` })
    .from(schema.paiement)
    .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
    .where(paiementsDeLaPeriode(siteId, periode))
    .groupBy(schema.paiement.mode)
    .all();
  return new Map(paiements.map((p) => [p.mode, p.total]));
}

function sectionParMode(parMode: Map<string, number>): { section: SectionEtat; total: number } {
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
      { cle: "encaisse", libelle: "Encaissé à ce jour", type: "fcfa", alignement: "droite" },
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

// Mise en forme de l'état à partir des données brutes de la période (journal, familles, modes) : commune au calcul d'un seul bloc et au calcul par tranches
function assemblerEtat(
  db: Db,
  siteId: number,
  periode: PeriodeExport,
  journal: LigneJournalVentes[],
  parFamille: Map<string, number>,
  parMode: Map<string, number>,
  options: OptionsEtatVentes,
): EtatImprimable {
  const limite = options.limiteDetail ?? LIMITE_DETAIL_PAR_DEFAUT;
  const modes = sectionParMode(parMode);
  return {
    identifiant: "etat-des-ventes",
    titre: "État des ventes",
    periode: { du: periode.du, au: periode.au },
    entete: entete(db, siteId),
    genereLe: (options.maintenant ?? new Date()).toISOString(),
    sections: [sectionParJour(journal), sectionParFamille(parFamille), modes.section, sectionDetail(journal, limite), sectionTotaux(journal, modes.total)],
    avertissements: journal.length > limite ? [`Détail limité aux ${espacerMilliers(limite)} premières factures : réduisez la période ou utilisez le CSV.`] : [],
  };
}

// Calcul d'un seul bloc : simple et sans pause, pour les périodes courtes et les tests.
export function construireEtatVentes(db: Db, siteId: number, periode: PeriodeExport, options: OptionsEtatVentes = {}): EtatImprimable {
  verifierPeriodeExport(periode);
  const { lignes: journal } = listerJournalVentes(db, siteId, periode);
  return assemblerEtat(db, siteId, periode, journal, repartitionFamilles(db, siteId, periode), encaissementsParMode(db, siteId, periode), options);
}

const FACTURES_CIBLE_PAR_TRANCHE = 2500;
const JOURS_MAX_PAR_TRANCHE = 31;

// Taille des tranches de calcul, selon le volume. Chaque tranche coûte ~30 ms de frais fixes (mesuré sur un an de ventes : des tranches d'un jour font
// passer le calcul de 1,2 s à 11,8 s) mais ne bloque le serveur que le temps de son contenu (des tranches d'un mois : 1,18 s au total, 122 ms de blocage
// au pire, contre 1,25 s d'un seul bloc). On vise donc environ 2 500 factures par tranche, d'un à 31 jours.
export function joursParTranchePourVolume(nombreFactures: number, nombreJours: number): number {
  if (nombreFactures <= 0) return JOURS_MAX_PAR_TRANCHE;
  return Math.min(JOURS_MAX_PAR_TRANCHE, Math.max(1, Math.floor((nombreJours * FACTURES_CIBLE_PAR_TRANCHE) / nombreFactures)));
}

// Découpe la période en tranches contiguës de `jours` jours (la dernière plus courte), sans trou ni recouvrement.
export function decouperEnTranches(periode: PeriodeExport, jours: number): PeriodeExport[] {
  const tranches: PeriodeExport[] = [];
  for (let debut = periode.du; debut <= periode.au; debut = decalerJour(debut, jours)) {
    const fin = decalerJour(debut, jours - 1);
    tranches.push({ du: debut, au: fin < periode.au ? fin : periode.au });
  }
  return tranches;
}

// Le MÊME état que construireEtatVentes, calculé tranche par tranche avec une pause entre chacune. Sur un an de ventes (25 000 factures), le calcul d'un
// seul bloc bloquait le serveur près de 3 secondes avec le PDF : un caissier qui encaisse au même moment attendait. Chaque tranche ne bloque plus que le
// temps de quelques jours de ventes. Les tranches se recollent sans perte : le journal est trié par date de facture, les paiements d'une facture sont
// lus en entier avec elle, les avoirs avec leur vente, et les familles et modes de paiement s'additionnent.
export async function construireEtatVentesCedant(db: Db, siteId: number, periode: PeriodeExport, options: OptionsEtatVentes = {}): Promise<EtatImprimable> {
  verifierPeriodeExport(periode);
  const journal: LigneJournalVentes[] = [];
  const parFamille = new Map<string, number>();
  const parMode = new Map<string, number>();
  const additionner = (total: Map<string, number>, partiel: Map<string, number>) => {
    for (const [cle, montant] of partiel) total.set(cle, (total.get(cle) ?? 0) + montant);
  };

  let joursParTranche = options.joursParTranche;
  if (joursParTranche === undefined) {
    const { nombre } = db.select({ nombre: sql<number>`count(*)` }).from(schema.facture).where(facturesDeLaPeriode(db, siteId, periode)).get()!;
    joursParTranche = joursParTranchePourVolume(nombre, joursAvantEcheance(periode.au, periode.du) + 1);
  }

  for (const tranche of decouperEnTranches(periode, joursParTranche)) {
    for (const ligne of listerJournalVentes(db, siteId, tranche).lignes) journal.push(ligne);
    additionner(parFamille, repartitionFamilles(db, siteId, tranche));
    additionner(parMode, encaissementsParMode(db, siteId, tranche));
    await cederLaMain();
  }
  return assemblerEtat(db, siteId, periode, journal, parFamille, parMode, options);
}
