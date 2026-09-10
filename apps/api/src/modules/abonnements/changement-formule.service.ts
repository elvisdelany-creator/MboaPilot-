import { eq } from "drizzle-orm";
import { validerMigrationFormule } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface ChangerFormuleParams {
  siteId: number;
  userId: number;
  numeroAbonnement: number;
  idNouvelleFormule: number;
  montantEncaisse: number;
  // 6.5 : moyen de paiement de l'encaissement — comptant par défaut ; le
  // Mobile Money suit son propre parcours dédié (paiement-mobile), jamais ici
  modePaiement?: "CASH" | "CHEQUE" | "VIREMENT";
  banque?: string; // chèque : "Banque" ; virement : "Banque émettrice"
  numeroCheque?: string;
  titulaireCheque?: string;
  dateCheque?: string;
  referenceVirement?: string;
}

export interface ChangerFormuleResultat {
  numeroAbonnement: number;
  idFacture: number;
  montantDifferentiel: number;
  statutFacture: "BROUILLON" | "VALIDEE";
}

// 7.4 : changement de formule (migration) — ne s'applique qu'à un abonnement
// ACTIF, vers une formule de rang strictement supérieur dans la même
// famille. Contrairement au réabonnement (7.2), les dates de la période en
// cours ne sont jamais recalculées : seule la formule change.
export function changerFormule(db: Db, params: ChangerFormuleParams): ChangerFormuleResultat {
  const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, params.numeroAbonnement)).get();
  if (!abonnement) throw new Error(`Abonnement ${params.numeroAbonnement} introuvable`);
  if (abonnement.statut !== "ACTIF") {
    throw new Error("Le changement de formule (migration) ne s'applique qu'à un abonnement actif (7.4)");
  }

  const formuleActuelle = db.select().from(schema.formule).where(eq(schema.formule.idFormule, abonnement.idFormule)).get();
  if (!formuleActuelle) throw new Error(`Formule ${abonnement.idFormule} introuvable`);
  const nouvelleFormule = db.select().from(schema.formule).where(eq(schema.formule.idFormule, params.idNouvelleFormule)).get();
  if (!nouvelleFormule) throw new Error(`Formule ${params.idNouvelleFormule} introuvable`);

  const validation = validerMigrationFormule(formuleActuelle, nouvelleFormule);
  if (!validation.autorise) throw new Error(validation.motif);

  db.insert(schema.historiqueAbonnement)
    .values({
      numeroAbonnement: params.numeroAbonnement,
      typeChangement: "FORMULE",
      valeurAvant: String(abonnement.idFormule),
      valeurApres: String(params.idNouvelleFormule),
      motif: "migration",
      utilisateurId: params.userId,
    })
    .run();

  db.update(schema.abonnement)
    .set({ idFormule: params.idNouvelleFormule })
    .where(eq(schema.abonnement.numeroAbonnement, params.numeroAbonnement))
    .run();

  const facture = db
    .insert(schema.facture)
    .values({ siteId: params.siteId, idAbonne: abonnement.idAbonne, creePar: params.userId, montantTotal: validation.montantDifferentiel })
    .returning()
    .get();

  db.insert(schema.ligneVente)
    .values({ idFacture: facture.idFacture, numeroAbonnement: params.numeroAbonnement, prixApplique: validation.montantDifferentiel })
    .run();

  let statutFacture: "BROUILLON" | "VALIDEE" = "BROUILLON";
  if (params.montantEncaisse > 0) {
    db.insert(schema.paiement)
      .values({
        idFacture: facture.idFacture,
        mode: params.modePaiement ?? "CASH",
        montant: params.montantEncaisse,
        utilisateurId: params.userId,
        banque: params.banque,
        numeroCheque: params.numeroCheque,
        titulaireCheque: params.titulaireCheque,
        dateCheque: params.dateCheque,
        referenceVirement: params.referenceVirement,
      })
      .run();
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();
    statutFacture = "VALIDEE";
  }

  return { numeroAbonnement: params.numeroAbonnement, idFacture: facture.idFacture, montantDifferentiel: validation.montantDifferentiel, statutFacture };
}
