import { sql } from "drizzle-orm";
import { construireCsv, joursAvantEcheance } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { cederLaMain } from "../../lib/ceder-la-main.js";
import { decouperEnTranches, joursParTranchePourVolume } from "../etats/etat-ventes.service.js";
import {
  apercuExportComptable,
  ENTETES_ENCAISSEMENTS,
  ENTETES_VENTES,
  facturesDeLaPeriode,
  lignesEncaissements,
  ligneCsvVentes,
  listerJournalVentes,
  verifierPeriodeExport,
  type ApercuExportComptable,
  type PeriodeExport,
} from "./export-comptable.service.js";

// Les mêmes exports que ceux de export-comptable.service, calculés tranche de jours après tranche de jours avec une pause entre chacune. Un an
// de ventes (100 000 factures) bloquait la boutique de 2,4 à 4,3 secondes en un seul bloc : le caissier qui encaisse au même moment attendait.
// Chaque tranche ne bloque plus que le temps de son contenu. Les tranches se recollent sans perte : le journal des ventes est trié par date de
// facture, celui des encaissements par date de paiement, et les totaux de l'aperçu s'additionnent.
export interface OptionsExportCedant {
  joursParTranche?: number; // taille des tranches, en jours (par défaut : selon le volume de la période)
}

function tranchesDeLaPeriode(db: Db, siteId: number, periode: PeriodeExport, options: OptionsExportCedant): PeriodeExport[] {
  verifierPeriodeExport(periode);
  let joursParTranche = options.joursParTranche;
  if (joursParTranche === undefined) {
    const { nombre } = db.select({ nombre: sql<number>`count(*)` }).from(schema.facture).where(facturesDeLaPeriode(db, siteId, periode)).get()!;
    joursParTranche = joursParTranchePourVolume(nombre, joursAvantEcheance(periode.au, periode.du) + 1);
  }
  return decouperEnTranches(periode, Math.max(1, Math.floor(joursParTranche)));
}

export async function exporterJournalVentesCsvCedant(db: Db, siteId: number, periode: PeriodeExport, options: OptionsExportCedant = {}): Promise<{ csv: string; nombre: number }> {
  const donnees: ReturnType<typeof ligneCsvVentes>[] = [];
  for (const tranche of tranchesDeLaPeriode(db, siteId, periode, options)) {
    for (const ligne of listerJournalVentes(db, siteId, tranche).lignes) donnees.push(ligneCsvVentes(ligne));
    await cederLaMain();
  }
  return { csv: construireCsv(ENTETES_VENTES, donnees, ";"), nombre: donnees.length };
}

export async function exporterJournalEncaissementsCsvCedant(db: Db, siteId: number, periode: PeriodeExport, options: OptionsExportCedant = {}): Promise<{ csv: string; nombre: number }> {
  const donnees: ReturnType<typeof lignesEncaissements> = [];
  for (const tranche of tranchesDeLaPeriode(db, siteId, periode, options)) {
    for (const ligne of lignesEncaissements(db, siteId, tranche)) donnees.push(ligne);
    await cederLaMain();
  }
  return { csv: construireCsv(ENTETES_ENCAISSEMENTS, donnees, ";"), nombre: donnees.length };
}

export async function apercuExportComptableCedant(db: Db, siteId: number, periode: PeriodeExport, options: OptionsExportCedant = {}): Promise<ApercuExportComptable> {
  const total: ApercuExportComptable = { ventes: { nombre: 0, totalTtc: 0, totalTva: 0 }, encaissements: { nombre: 0, total: 0 } };
  for (const tranche of tranchesDeLaPeriode(db, siteId, periode, options)) {
    const partiel = apercuExportComptable(db, siteId, tranche);
    total.ventes.nombre += partiel.ventes.nombre;
    total.ventes.totalTtc += partiel.ventes.totalTtc;
    total.ventes.totalTva += partiel.ventes.totalTva;
    total.encaissements.nombre += partiel.encaissements.nombre;
    total.encaissements.total += partiel.encaissements.total;
    await cederLaMain();
  }
  return total;
}
