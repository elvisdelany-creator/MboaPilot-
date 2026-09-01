import { eq } from "drizzle-orm";
import { detecterJalonAlerte, evaluerExpiration, evaluerSuiviCommission } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface JobQuotidienResultat {
  abonnementsExpires: number;
  alertesCreees: number;
  commissionsConfirmees: number;
  commissionsAnnulees: number;
}

// 4.3, 4.4, 6.2 : job quotidien — fait transitionner les abonnements expirés,
// journalise les alertes J-7/J-3/J-1, évalue le suivi de commission CANAL+.
// Exécuté sans utilisateur humain : les traces d'historique portent
// utilisateur_id = NULL pour distinguer une action système d'une action manuelle.
export function executerJobQuotidien(db: Db, aujourdHui: string): JobQuotidienResultat {
  const resultat: JobQuotidienResultat = {
    abonnementsExpires: 0,
    alertesCreees: 0,
    commissionsConfirmees: 0,
    commissionsAnnulees: 0,
  };

  const abonnementsActifs = db.select().from(schema.abonnement).where(eq(schema.abonnement.statut, "ACTIF")).all();

  for (const abonnement of abonnementsActifs) {
    const nouveauStatut = evaluerExpiration(abonnement.statut, abonnement.dateFin, aujourdHui);
    if (nouveauStatut !== abonnement.statut) {
      db.update(schema.abonnement)
        .set({ statut: nouveauStatut })
        .where(eq(schema.abonnement.numeroAbonnement, abonnement.numeroAbonnement))
        .run();
      db.insert(schema.historiqueAbonnement)
        .values({
          numeroAbonnement: abonnement.numeroAbonnement,
          typeChangement: "STATUT",
          valeurAvant: abonnement.statut,
          valeurApres: nouveauStatut,
          motif: "expiration_automatique",
          utilisateurId: null,
        })
        .run();
      resultat.abonnementsExpires += 1;
      continue; // un abonnement qui vient d'expirer n'est plus éligible à une alerte de rappel
    }

    const jalon = detecterJalonAlerte(abonnement.dateFin, aujourdHui);
    if (jalon) {
      const dejaEnvoyee = db
        .select()
        .from(schema.alerteEcheance)
        .where(eq(schema.alerteEcheance.numeroAbonnement, abonnement.numeroAbonnement))
        .all()
        .some((a) => a.jalon === jalon && a.dateDeclenchement === aujourdHui);
      if (!dejaEnvoyee) {
        db.insert(schema.alerteEcheance)
          .values({ numeroAbonnement: abonnement.numeroAbonnement, jalon, dateDeclenchement: aujourdHui })
          .run();
        resultat.alertesCreees += 1;
      }
    }
  }

  const suivisEnCours = db
    .select()
    .from(schema.suiviCommissionCanalplus)
    .where(eq(schema.suiviCommissionCanalplus.statut, "EN_COURS"))
    .all();

  for (const suivi of suivisEnCours) {
    const abonnementCourant = db
      .select()
      .from(schema.abonnement)
      .where(eq(schema.abonnement.numeroAbonnement, suivi.numeroAbonnement))
      .get();
    if (!abonnementCourant) continue;

    const nouveauStatutSuivi = evaluerSuiviCommission(
      suivi.statut,
      abonnementCourant.statut,
      suivi.dateFinProbatoire,
      aujourdHui
    );
    if (nouveauStatutSuivi !== suivi.statut) {
      db.update(schema.suiviCommissionCanalplus)
        .set({ statut: nouveauStatutSuivi })
        .where(eq(schema.suiviCommissionCanalplus.idSuivi, suivi.idSuivi))
        .run();
      if (nouveauStatutSuivi === "CONFIRMEE") resultat.commissionsConfirmees += 1;
      if (nouveauStatutSuivi === "ANNULEE") resultat.commissionsAnnulees += 1;
    }
  }

  return resultat;
}
