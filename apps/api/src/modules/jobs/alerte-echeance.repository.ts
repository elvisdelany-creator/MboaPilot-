import { eq } from "drizzle-orm";
import { classerUrgenceEcheance, joursAvantEcheance } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverJalonsAlerteParSite } from "../entreprise/entreprise.repository.js";

export interface AlerteEcheanceDetaillee {
  numeroAbonnement: number;
  jalon: number; // 8.8 : jours du seuil configuré atteint (plus un libellé fixe "J-7")
  rang: 1 | 2 | 3; // 1 = le plus urgent, quels que soient les jalons configurés
  joursRestants: number;
  dateFin: string;
  // abonné et formule complets : le tableau de bord en a besoin pour
  // pré-sélectionner l'abonné (et sa famille) sur l'écran de caisse en un clic (4.4, 9.3)
  abonne: typeof schema.abonne.$inferSelect;
  formule: typeof schema.formule.$inferSelect;
}

// 9.3, 8.8 : liste vivante (pas un rejeu du journal d'alertes, 4.4) des
// abonnements ACTIF à échéance sous le jalon le plus anticipé configuré,
// cloisonnée par site, triée par urgence. Un abonnement réabonné (date_fin
// repoussée) sort naturellement de la liste, sans purger le journal d'alertes.
export function listerAlertesEcheance(db: Db, siteId: number, aujourdHui: string): AlerteEcheanceDetaillee[] {
  const jalonsConfigures = trouverJalonsAlerteParSite(db, siteId);

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
    .map((l) => ({ ...l, classement: classerUrgenceEcheance(l.joursRestants, jalonsConfigures) }))
    .filter((l): l is typeof l & { classement: NonNullable<typeof l.classement> } => l.classement !== null)
    .map((l) => ({ ...l, jalon: l.classement.jours, rang: l.classement.rang }))
    .sort((a, b) => a.joursRestants - b.joursRestants);
}
