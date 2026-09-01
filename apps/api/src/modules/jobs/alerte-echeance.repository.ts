import { eq } from "drizzle-orm";
import { joursAvantEcheance, type JalonAlerte } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface AlerteEcheanceDetaillee {
  numeroAbonnement: number;
  jalon: JalonAlerte;
  joursRestants: number;
  dateFin: string;
  // abonné et formule complets : le tableau de bord en a besoin pour
  // pré-sélectionner l'abonné (et sa famille) sur l'écran de caisse en un clic (4.4, 9.3)
  abonne: typeof schema.abonne.$inferSelect;
  formule: typeof schema.formule.$inferSelect;
}

const SEUILS: [number, JalonAlerte][] = [
  [1, "J-1"],
  [3, "J-3"],
  [7, "J-7"],
];

function classer(joursRestants: number): JalonAlerte | null {
  for (const [seuil, jalon] of SEUILS) {
    if (joursRestants <= seuil) return jalon;
  }
  return null;
}

// 9.3 : liste vivante (pas un rejeu du journal d'alertes, 4.4) des abonnements
// ACTIF à échéance sous 7 jours, cloisonnée par site, triée par urgence.
// Un abonnement réabonné (date_fin repoussée) sort naturellement de la liste,
// sans qu'il soit nécessaire de purger le journal d'alertes.
export function listerAlertesEcheance(db: Db, siteId: number, aujourdHui: string): AlerteEcheanceDetaillee[] {
  const lignes = db
    .select({ abonnement: schema.abonnement, abonne: schema.abonne, formule: schema.formule })
    .from(schema.abonnement)
    .innerJoin(schema.abonne, eq(schema.abonnement.idAbonne, schema.abonne.idAbonne))
    .innerJoin(schema.formule, eq(schema.abonnement.idFormule, schema.formule.idFormule))
    .where(eq(schema.abonnement.siteId, siteId))
    .all()
    .filter((l) => l.abonnement.statut === "ACTIF");

  return lignes
    .map((l) => ({
      numeroAbonnement: l.abonnement.numeroAbonnement,
      dateFin: l.abonnement.dateFin,
      joursRestants: joursAvantEcheance(l.abonnement.dateFin, aujourdHui),
      abonne: l.abonne,
      formule: l.formule,
    }))
    .filter((l) => l.joursRestants >= 0)
    .map((l) => ({ ...l, jalon: classer(l.joursRestants) }))
    .filter((l): l is AlerteEcheanceDetaillee => l.jalon !== null)
    .sort((a, b) => a.joursRestants - b.joursRestants);
}
