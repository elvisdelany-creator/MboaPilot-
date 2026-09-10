import { eq } from "drizzle-orm";
import { calculerDateFin, joursAvantEcheance } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverDelaiGraceReabonnementEntreprise } from "../entreprise/entreprise.repository.js";

export interface ReabonnerParams {
  siteId: number;
  userId: number;
  aujourdHui: string; // horloge injectée — nouvelle période calculée à partir de cette date, sauf délai de grâce applicable (4.3, 7.2)
  numeroAbonnement: number;
  idFormule?: number; // absent = reconduction de la formule actuelle
  montantEncaisse: number;
  // 6.4, 7.2 : "remise ponctuelle" — montant en FCFA déduit du prix de la formule
  remise?: number;
  // 6.5 : moyen de paiement de l'encaissement — comptant par défaut ; le
  // Mobile Money suit son propre parcours dédié (paiement-mobile), jamais ici
  modePaiement?: "CASH" | "CHEQUE" | "VIREMENT";
  banque?: string; // chèque : "Banque" ; virement : "Banque émettrice"
  numeroCheque?: string;
  titulaireCheque?: string;
  dateCheque?: string;
  referenceVirement?: string;
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

  const remise = params.remise ?? 0;
  if (remise < 0) throw new Error("La remise ne peut pas être négative");
  if (remise > formule.prix) throw new Error(`La remise (${remise}) dépasse le prix de la formule (${formule.prix})`);

  // 4.3, 8.8 : "délai de grâce" — un réabonnement tardif effectué dans ce
  // délai après la date_fin théorique précédente redémarre à compter de
  // cette date_fin plutôt que de la date réelle de paiement, pour ne pas
  // pénaliser un client en léger retard (paramétrable, 0 jour par défaut).
  const delaiGrace = trouverDelaiGraceReabonnementEntreprise(db);
  const joursDepuisExpiration = -joursAvantEcheance(abonnementActuel.dateFin, params.aujourdHui);
  const dansLeDelaiDeGrace = abonnementActuel.statut === "EXPIRE" && joursDepuisExpiration > 0 && joursDepuisExpiration <= delaiGrace;

  const dateDebut = dansLeDelaiDeGrace ? abonnementActuel.dateFin : params.aujourdHui;
  const dateFin = calculerDateFin(dateDebut, formule.dureeCycles, formule.modeDuree);

  if (dansLeDelaiDeGrace) {
    db.insert(schema.historiqueAbonnement)
      .values({
        numeroAbonnement: params.numeroAbonnement,
        typeChangement: "STATUT",
        valeurAvant: "EXPIRE",
        valeurApres: "ACTIF",
        motif: `reabonnement_delai_grace (${joursDepuisExpiration} j après échéance)`,
        utilisateurId: params.userId,
      })
      .run();
  }

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

  const prixApplique = formule.prix - remise;

  const facture = db
    .insert(schema.facture)
    .values({ siteId: params.siteId, idAbonne: abonnementActuel.idAbonne, creePar: params.userId, montantTotal: prixApplique })
    .returning()
    .get();

  db.insert(schema.ligneVente)
    .values({ idFacture: facture.idFacture, numeroAbonnement: params.numeroAbonnement, prixApplique, remise })
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

  return { numeroAbonnement: params.numeroAbonnement, idFacture: facture.idFacture, statutFacture };
}
