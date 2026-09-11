import { and, eq } from "drizzle-orm";
import { validerMigrationFormule } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface ChangerFormuleParams {
  siteId: number;
  userId: number;
  numeroAbonnement: number;
  idNouvelleFormule: number;
  // 3.2.2, 5.4.2, 7.4 : "l'historique du changement de formule (et des
  // compléments associés) est conservé" — chaque option doit être
  // compatible avec la nouvelle formule (formule_option_compat)
  idsOptions?: number[];
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

  // 3.2.2, 5.4.2, 7.4 : "ajuster ses options" lors de la migration — mêmes
  // règles de compatibilité et de tarif différencié que pour le
  // recrutement/réabonnement, vis-à-vis de la nouvelle formule
  const optionsAppliquees = (params.idsOptions ?? []).map((idOption) => {
    const option = db.select().from(schema.optionComplement).where(eq(schema.optionComplement.idOption, idOption)).get();
    if (!option) throw new Error(`Option ${idOption} introuvable`);
    const compat = db
      .select()
      .from(schema.formuleOptionCompat)
      .where(and(eq(schema.formuleOptionCompat.idFormule, params.idNouvelleFormule), eq(schema.formuleOptionCompat.idOption, idOption)))
      .get();
    if (!compat) throw new Error(`Option "${option.libelle}" non compatible avec la formule "${nouvelleFormule.libelle}"`);
    return { idOption, prixApplique: compat.prixSurcharge ?? option.prix };
  });
  const prixOptions = optionsAppliquees.reduce((total, o) => total + o.prixApplique, 0);
  const montantTotal = validation.montantDifferentiel + prixOptions;

  const facture = db
    .insert(schema.facture)
    .values({ siteId: params.siteId, idAbonne: abonnement.idAbonne, creePar: params.userId, montantTotal })
    .returning()
    .get();

  db.insert(schema.ligneVente)
    .values({ idFacture: facture.idFacture, numeroAbonnement: params.numeroAbonnement, prixApplique: validation.montantDifferentiel })
    .run();

  for (const o of optionsAppliquees) {
    db.insert(schema.ligneVente)
      .values({ idFacture: facture.idFacture, idOption: o.idOption, numeroAbonnement: params.numeroAbonnement, prixApplique: o.prixApplique })
      .run();
  }

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
