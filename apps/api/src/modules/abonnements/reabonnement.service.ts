import { eq } from "drizzle-orm";
import { calculerDateFin } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface ReabonnerParams {
  siteId: number;
  userId: number;
  aujourdHui: string; // horloge injectée — nouvelle période calculée à partir de cette date (7.2, pas de délai de grâce en MVP)
  numeroAbonnement: number;
  idFormule?: number; // absent = reconduction de la formule actuelle
  montantEncaisse: number;
}

export interface ReabonnementResultat {
  numeroAbonnement: number;
  idFacture: number;
  statutFacture: "BROUILLON" | "VALIDEE";
}

// 7.2 : renouvellement d'un abonnement déjà existant pour un abonné déjà connu.
// Réutilise le même numero_abonnement (contrairement à un échange de matériel, 7.3).
export function reabonner(db: Db, params: ReabonnerParams): ReabonnementResultat {
  const abonnementActuel = db
    .select()
    .from(schema.abonnement)
    .where(eq(schema.abonnement.numeroAbonnement, params.numeroAbonnement))
    .get();
  if (!abonnementActuel) throw new Error(`Abonnement ${params.numeroAbonnement} introuvable`);

  const idFormule = params.idFormule ?? abonnementActuel.idFormule;
  const formule = db.select().from(schema.formule).where(eq(schema.formule.idFormule, idFormule)).get();
  if (!formule) throw new Error(`Formule ${idFormule} introuvable`);

  const dateDebut = params.aujourdHui;
  const dateFin = calculerDateFin(dateDebut, formule.dureeCycles, formule.modeDuree);

  if (idFormule !== abonnementActuel.idFormule) {
    db.insert(schema.historiqueAbonnement)
      .values({
        numeroAbonnement: params.numeroAbonnement,
        typeChangement: "FORMULE",
        valeurAvant: String(abonnementActuel.idFormule),
        valeurApres: String(idFormule),
        motif: "reabonnement",
        utilisateurId: params.userId,
      })
      .run();
  }

  db.update(schema.abonnement)
    .set({ idFormule, dateDebut, dateFin, statut: "ACTIF" })
    .where(eq(schema.abonnement.numeroAbonnement, params.numeroAbonnement))
    .run();

  const facture = db
    .insert(schema.facture)
    .values({ siteId: params.siteId, idAbonne: abonnementActuel.idAbonne, creePar: params.userId, montantTotal: formule.prix })
    .returning()
    .get();

  db.insert(schema.ligneVente)
    .values({ idFacture: facture.idFacture, numeroAbonnement: params.numeroAbonnement, prixApplique: formule.prix })
    .run();

  let statutFacture: "BROUILLON" | "VALIDEE" = "BROUILLON";
  if (params.montantEncaisse > 0) {
    db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: params.montantEncaisse }).run();
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();
    statutFacture = "VALIDEE";
  }

  return { numeroAbonnement: params.numeroAbonnement, idFacture: facture.idFacture, statutFacture };
}
