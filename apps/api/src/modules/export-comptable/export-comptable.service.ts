import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { bornesJourDouala, construireCsv, heureDouala, jourDouala } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

// Export comptable (offre Pro du cahier des charges) : deux journaux CSV pour la clôture du mois — les ventes (avec la TVA figée à la
// vente) et les encaissements (avec de quoi les retrouver sur le relevé bancaire). Le jour est celui de Douala, comme le tableau de
// bord : le comptable doit y retrouver les mêmes totaux que l'écran.

export interface PeriodeExport {
  du: string; // AAAA-MM-JJ, inclus
  au: string; // AAAA-MM-JJ, inclus
}

const JOURS_MAX = 366;
const MS_PAR_JOUR = 86_400_000;

function instantDuJour(valeur: unknown, nom: string): number {
  const correspondance = typeof valeur === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur) : null;
  const instant = correspondance ? Date.UTC(Number(correspondance[1]), Number(correspondance[2]) - 1, Number(correspondance[3])) : NaN;
  // aller-retour : 2026-02-30 est « bien formée » mais n'existe pas
  if (!correspondance || new Date(instant).toISOString().slice(0, 10) !== valeur) {
    throw new Error(`La date de ${nom} de la période doit être une date valide au format AAAA-MM-JJ`);
  }
  return instant;
}

export function verifierPeriodeExport(periode: PeriodeExport): void {
  const debut = instantDuJour(periode?.du, "début");
  const fin = instantDuJour(periode?.au, "fin");
  if (fin < debut) throw new Error("La période est inversée : la date de fin précède la date de début");
  if ((fin - debut) / MS_PAR_JOUR + 1 > JOURS_MAX) throw new Error(`La période est trop longue (${JOURS_MAX} jours au plus) : exportez année par année`);
}

// [debut, fin[ en UTC, au format des horodatages SQLite : couvre du premier au dernier jour de Douala
function plage(periode: PeriodeExport) {
  return { debut: bornesJourDouala(periode.du).debut, fin: bornesJourDouala(periode.au).fin };
}

const dateFr = (horodatage: string) => jourDouala(horodatage).split("-").reverse().join("/");
const nomComplet = (prenom: string | null, nom: string | null) => (nom === null ? "Sans client" : `${prenom} ${nom}`);

function facturesDeLaPeriode(db: Db, siteId: number, periode: PeriodeExport) {
  const { debut, fin } = plage(periode);
  return and(eq(schema.facture.siteId, siteId), eq(schema.facture.statut, "VALIDEE"), gte(schema.facture.dateCreation, debut), lt(schema.facture.dateCreation, fin));
}

function paiementsDeLaPeriode(siteId: number, periode: PeriodeExport) {
  const { debut, fin } = plage(periode);
  return and(eq(schema.facture.siteId, siteId), gte(schema.paiement.datePaiement, debut), lt(schema.paiement.datePaiement, fin));
}

// Journal des ventes : une ligne par facture validée (les ventes en attente de paiement n'en font pas partie, comme du chiffre
// d'affaires), les avoirs en négatif avec la facture qu'ils corrigent. Le plus ancien en premier.
export function exporterJournalVentesCsv(db: Db, siteId: number, periode: PeriodeExport): { csv: string; nombre: number } {
  verifierPeriodeExport(periode);
  const filtre = facturesDeLaPeriode(db, siteId, periode);

  const factures = db
    .select({ facture: schema.facture, prenom: schema.abonne.prenom, nom: schema.abonne.nom })
    .from(schema.facture)
    .leftJoin(schema.abonne, eq(schema.facture.idAbonne, schema.abonne.idAbonne))
    .where(filtre)
    .orderBy(asc(schema.facture.dateCreation), asc(schema.facture.idFacture))
    .all();

  // en une requête pour toute la période, jamais une par facture ni une liste de numéros (limite de variables de SQLite)
  const lignesDeVente = db
    .select({
      idFacture: schema.ligneVente.idFacture,
      quantite: schema.ligneVente.quantite,
      produit: schema.produit.libelle,
      kit: schema.kit.libelle,
      option: schema.optionComplement.libelle,
      formule: schema.formule.libelle,
    })
    .from(schema.ligneVente)
    .innerJoin(schema.facture, eq(schema.ligneVente.idFacture, schema.facture.idFacture))
    .leftJoin(schema.produit, eq(schema.ligneVente.idProduit, schema.produit.idProduit))
    .leftJoin(schema.kit, eq(schema.ligneVente.idKit, schema.kit.idKit))
    .leftJoin(schema.optionComplement, eq(schema.ligneVente.idOption, schema.optionComplement.idOption))
    .leftJoin(schema.abonnement, eq(schema.ligneVente.numeroAbonnement, schema.abonnement.numeroAbonnement))
    .leftJoin(schema.formule, eq(schema.abonnement.idFormule, schema.formule.idFormule))
    .where(filtre)
    .orderBy(asc(schema.ligneVente.idLigne))
    .all();
  const detailParFacture = new Map<number, string[]>();
  for (const l of lignesDeVente) {
    const libelle = l.produit ?? l.kit ?? l.option ?? l.formule ?? "Ligne sans libellé";
    detailParFacture.set(l.idFacture, [...(detailParFacture.get(l.idFacture) ?? []), `${l.quantite} × ${libelle}`]);
  }

  const encaisse = new Map(
    db
      .select({ idFacture: schema.paiement.idFacture, total: sql<number>`sum(${schema.paiement.montant})` })
      .from(schema.paiement)
      .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
      .where(filtre)
      .groupBy(schema.paiement.idFacture)
      .all()
      .map((p) => [p.idFacture, p.total]),
  );

  const lignes = factures.map(({ facture: f, prenom, nom }) => {
    const paye = encaisse.get(f.idFacture) ?? 0;
    return [
      dateFr(f.dateCreation),
      f.idFacture,
      f.type === "AVOIR" ? "Avoir" : "Vente",
      f.factureOrigineId ?? "",
      f.idAbonne ?? "",
      nomComplet(prenom, nom),
      (detailParFacture.get(f.idFacture) ?? []).join(" + "),
      f.montantTotal,
      f.montantTaxe,
      f.montantTotal - f.montantTaxe,
      paye,
      f.montantTotal - paye,
    ];
  });

  const entetes = ["Date", "N° facture", "Type", "Facture d'origine", "N° client", "Client", "Détail", "Total TTC", "dont TVA", "Total HT", "Encaissé", "Reste à payer"];
  return { csv: construireCsv(entetes, lignes, ";"), nombre: lignes.length };
}

const LIBELLE_MODE = { CASH: "Espèces", CHEQUE: "Chèque", VIREMENT: "Virement", MOBILE_MONEY: "Mobile Money" } as const;
const LIBELLE_RAPPROCHEMENT = { EN_ATTENTE: "En attente", RAPPROCHE: "Rapproché" } as const;

// Journal des encaissements : un paiement par ligne, sur sa propre date (un acompte et son solde tombent chacun dans leur mois).
// Un remboursement (avoir) est en négatif. La banque et la référence servent à le retrouver sur le relevé.
export function exporterJournalEncaissementsCsv(db: Db, siteId: number, periode: PeriodeExport): { csv: string; nombre: number } {
  verifierPeriodeExport(periode);

  const paiements = db
    .select({ paiement: schema.paiement, prenom: schema.abonne.prenom, nom: schema.abonne.nom, auteurPrenom: schema.utilisateur.prenom, auteurNom: schema.utilisateur.nom })
    .from(schema.paiement)
    .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
    .leftJoin(schema.abonne, eq(schema.facture.idAbonne, schema.abonne.idAbonne))
    .leftJoin(schema.utilisateur, eq(schema.paiement.utilisateurId, schema.utilisateur.idUser))
    .where(paiementsDeLaPeriode(siteId, periode))
    .orderBy(asc(schema.paiement.datePaiement), asc(schema.paiement.idPaiement))
    .all();

  const lignes = paiements.map(({ paiement: p, prenom, nom, auteurPrenom, auteurNom }) => [
    dateFr(p.datePaiement),
    heureDouala(p.datePaiement),
    p.idPaiement,
    p.idFacture,
    nomComplet(prenom, nom),
    LIBELLE_MODE[p.mode],
    p.montant,
    p.banque ?? "",
    (p.mode === "CHEQUE" ? p.numeroCheque : p.mode === "VIREMENT" ? p.referenceVirement : p.mode === "MOBILE_MONEY" ? p.referenceTransaction : null) ?? "",
    p.statutRapprochement ? LIBELLE_RAPPROCHEMENT[p.statutRapprochement] : "—",
    auteurNom === null ? "" : `${auteurPrenom} ${auteurNom}`,
  ]);

  const entetes = ["Date", "Heure", "N° paiement", "N° facture", "Client", "Mode", "Montant", "Banque", "Référence", "Rapprochement", "Encaissé par"];
  return { csv: construireCsv(entetes, lignes, ";"), nombre: lignes.length };
}

export interface ApercuExportComptable {
  ventes: { nombre: number; totalTtc: number; totalTva: number };
  encaissements: { nombre: number; total: number };
}

// ce que contiendront les deux fichiers, avant de les télécharger : le comptable le compare à ses propres totaux
export function apercuExportComptable(db: Db, siteId: number, periode: PeriodeExport): ApercuExportComptable {
  verifierPeriodeExport(periode);
  const ventes = db
    .select({ nombre: sql<number>`count(*)`, totalTtc: sql<number>`coalesce(sum(${schema.facture.montantTotal}), 0)`, totalTva: sql<number>`coalesce(sum(${schema.facture.montantTaxe}), 0)` })
    .from(schema.facture)
    .where(facturesDeLaPeriode(db, siteId, periode))
    .get()!;
  const encaissements = db
    .select({ nombre: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${schema.paiement.montant}), 0)` })
    .from(schema.paiement)
    .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
    .where(paiementsDeLaPeriode(siteId, periode))
    .get()!;
  return { ventes, encaissements };
}
