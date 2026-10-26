import { and, eq } from "drizzle-orm";
import { calculerDateFin, decalerJour, extraireTaxeDuTTC, joursAvantEcheance, peutAffecterEcran } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { exigerRemiseAutorisee, trouverDelaiGraceReabonnementEntreprise, trouverTauxTvaParSite } from "../entreprise/entreprise.repository.js";
import { creerPaiement } from "../factures/paiement.repository.js";
import { compterEcransOccupes, trouverComptePartage } from "../comptes-partages/compte-partage.repository.js";
import { verifierEncaissementSaisi, verifierTotalAttendu } from "../../lib/validation.js";
import { dernierIdHistorique, enregistrerOperationEnAttente, etatAbonnement } from "./operation-en-attente.repository.js";

export interface ReabonnerParams {
  siteId: number;
  userId: number;
  aujourdHui: string; // horloge injectée — nouvelle période calculée à partir de cette date, sauf délai de grâce applicable (4.3, 7.2)
  numeroAbonnement: number;
  idFormule?: number; // absent = reconduction de la formule actuelle
  // 3.2.2, 5.4.2, 7.2 : "ajuster ses options" au réabonnement — chacune doit
  // être compatible avec la formule (nouvelle ou reconduite)
  idsOptions?: number[];
  montantEncaisse: number;
  // total affiché à la caisse : le réabonnement est refusé si un prix a changé entre-temps (verifierTotalAttendu)
  totalAttendu?: number;
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
  // 13.1 : "QR code de vérification" — voir recrutement.service.ts
  jetonVerification: string;
  statutFacture: "BROUILLON" | "VALIDEE";
  montantTaxe: number;
}

// 7.2 : renouvellement d'un abonnement déjà existant pour un abonné déjà connu.
// Réutilise le même numero_abonnement (contrairement à un échange de matériel, 7.3).
export function reabonner(db: Db, params: ReabonnerParams): ReabonnementResultat {
  verifierEncaissementSaisi(params);
  // atomique : l'abonnement était renouvelé (dates, statut, historique) avant la
  // validation des options — une option incompatible offrait un mois sans facture
  return db.transaction(() => reabonnerSansTransaction(db, params));
}

function reabonnerSansTransaction(db: Db, params: ReabonnerParams): ReabonnementResultat {
  const abonnementActuel = db
    .select()
    .from(schema.abonnement)
    .where(eq(schema.abonnement.numeroAbonnement, params.numeroAbonnement))
    .get();
  if (!abonnementActuel) throw new Error(`Abonnement ${params.numeroAbonnement} introuvable`);
  // de quoi défaire le réabonnement s'il n'est jamais payé (annulation-facture.service.ts)
  const etatAvant = etatAbonnement(db, params.numeroAbonnement);
  const reperHistorique = dernierIdHistorique(db);

  // 5.9 : un écran se libère à l'expiration (ou à la résiliation) et un autre client a pu le prendre. Réactiver
  // l'abonnement redemande cet écran : sans contrôle, le compte dépasserait la limite du fournisseur. Un abonnement
  // encore ACTIF occupe déjà le sien : son renouvellement n'y change rien.
  if (abonnementActuel.idComptePartage !== null && abonnementActuel.statut !== "ACTIF") {
    const comptePartage = trouverComptePartage(db, abonnementActuel.idComptePartage);
    if (comptePartage) {
      if (comptePartage.actif !== 1) throw new Error(`Le compte partagé "${comptePartage.libelle}" est désactivé : réactivez-le avant de réabonner ce client`);
      const ecransOccupes = compterEcransOccupes(db, abonnementActuel.idComptePartage);
      if (!peutAffecterEcran(comptePartage.nombreEcransMax, ecransOccupes)) {
        throw new Error(
          `Capacité atteinte : l'écran de ce client sur "${comptePartage.libelle}" a été repris (${ecransOccupes}/${comptePartage.nombreEcransMax}). ` +
            "Libérez un écran de ce compte ou augmentez sa capacité avant de réabonner ce client"
        );
      }
    }
  }

  const idFormule = params.idFormule ?? abonnementActuel.idFormule;
  const formule = db.select().from(schema.formule).where(eq(schema.formule.idFormule, idFormule)).get();
  if (!formule) throw new Error(`Formule ${idFormule} introuvable`);
  // changer de formule au réabonnement : même famille (compte partagé, matériel et commissions restent
  // rattachés à l'abonnement) et formule encore en vente. La reconduction à l'identique, elle, reste permise
  // même si la formule a été retirée de la vente : le client n'est pas bloqué (8.8).
  if (idFormule !== abonnementActuel.idFormule) {
    const formuleActuelle = db.select().from(schema.formule).where(eq(schema.formule.idFormule, abonnementActuel.idFormule)).get();
    if (formuleActuelle && formuleActuelle.idFamille !== formule.idFamille) {
      throw new Error("La nouvelle formule doit appartenir à la même famille d'abonnement que l'abonnement renouvelé");
    }
    if (formule.actif !== 1) throw new Error(`La formule "${formule.libelle}" n'est plus en vente`);
  }

  const remise = params.remise ?? 0;
  if (remise < 0) throw new Error("La remise ne peut pas être négative");
  if (remise > formule.prix) throw new Error(`La remise (${remise}) dépasse le prix de la formule (${formule.prix})`);
  exigerRemiseAutorisee(db, params.userId, remise, formule.prix);

  // 4.3, 8.8 : "délai de grâce" — un réabonnement tardif effectué dans ce
  // délai après la date_fin théorique précédente redémarre à compter de
  // cette date_fin plutôt que de la date réelle de paiement, pour ne pas
  // pénaliser un client en léger retard (paramétrable, 0 jour par défaut).
  // Basé sur les dates réelles, jamais sur le statut stocké : le job
  // quotidien qui bascule le statut à EXPIRE ne tourne qu'une fois par jour,
  // et un client peut se réabonner avant son passage (statut encore ACTIF
  // alors que la date de fin est déjà dépassée) — seule une résiliation
  // explicite (RESILIE) est exclue du délai de grâce.
  const delaiGrace = trouverDelaiGraceReabonnementEntreprise(db);
  const joursDepuisExpiration = -joursAvantEcheance(abonnementActuel.dateFin, params.aujourdHui);
  const dansLeDelaiDeGrace = abonnementActuel.statut !== "RESILIE" && joursDepuisExpiration > 0 && joursDepuisExpiration <= delaiGrace;

  // 4.3, 7.2 : un réabonnement fait AVANT la fin de la période (ou le jour même) prolonge la période en cours, sans perdre un seul jour
  // déjà payé : la nouvelle période démarre le lendemain de la fin actuelle. Partir de la date du paiement faisait perdre au client
  // les jours qui lui restaient (23 jours de service pour 30 payés à 7 jours de l'échéance) et annulait à tort la commission CANAL+
  // d'un client pourtant jamais interrompu (6.2). Après l'échéance, la date du réabonnement (ou le délai de grâce) s'applique toujours.
  const avantLEcheance = abonnementActuel.statut !== "RESILIE" && joursAvantEcheance(abonnementActuel.dateFin, params.aujourdHui) >= 0;
  const dateDebut = avantLEcheance ? decalerJour(abonnementActuel.dateFin, 1) : dansLeDelaiDeGrace ? abonnementActuel.dateFin : params.aujourdHui;
  const dateFin = calculerDateFin(dateDebut, formule.dureeCycles, formule.modeDuree);

  if (dansLeDelaiDeGrace) {
    db.insert(schema.historiqueAbonnement)
      .values({
        numeroAbonnement: params.numeroAbonnement,
        typeChangement: "STATUT",
        valeurAvant: abonnementActuel.statut,
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

  // 3.2.2, 5.4.2, 7.2 : "ajuster ses options" — même règle de compatibilité
  // et de tarif différencié qu'au recrutement (5.4.2)
  // une option ne se vend qu'une fois par abonnement : un doublon est ignoré
  const optionsAppliquees = [...new Set(params.idsOptions ?? [])].map((idOption) => {
    const option = db.select().from(schema.optionComplement).where(eq(schema.optionComplement.idOption, idOption)).get();
    if (!option) throw new Error(`Option ${idOption} introuvable`);
    const compat = db
      .select()
      .from(schema.formuleOptionCompat)
      .where(and(eq(schema.formuleOptionCompat.idFormule, idFormule), eq(schema.formuleOptionCompat.idOption, idOption)))
      .get();
    if (!compat) throw new Error(`Option "${option.libelle}" non compatible avec la formule "${formule.libelle}"`);
    return { idOption, prixApplique: compat.prixSurcharge ?? option.prix };
  });
  const prixOptions = optionsAppliquees.reduce((total, o) => total + o.prixApplique, 0);

  const prixApplique = formule.prix - remise;
  const montantTotal = prixApplique + prixOptions;
  verifierTotalAttendu(montantTotal, params.totalAttendu);

  // 3.2.3, 6.1, 8.8 : "porte le total, la TVA/taxes le cas échéant" — figée
  // au taux en vigueur à cet instant, jamais recalculée après coup
  const montantTaxe = extraireTaxeDuTTC(montantTotal, trouverTauxTvaParSite(db, params.siteId));

  const facture = db
    .insert(schema.facture)
    .values({ siteId: params.siteId, idAbonne: abonnementActuel.idAbonne, creePar: params.userId, montantTotal, montantTaxe })
    .returning()
    .get();

  db.insert(schema.ligneVente)
    .values({ idFacture: facture.idFacture, numeroAbonnement: params.numeroAbonnement, prixApplique, remise })
    .run();

  for (const o of optionsAppliquees) {
    db.insert(schema.ligneVente)
      .values({ idFacture: facture.idFacture, idOption: o.idOption, numeroAbonnement: params.numeroAbonnement, prixApplique: o.prixApplique })
      .run();
  }

  let statutFacture: "BROUILLON" | "VALIDEE" = "BROUILLON";
  if (montantTotal === 0) {
    // rien à encaisser : une facture à 0 FCFA resterait sinon BROUILLON pour toujours (ni encaissable, ni imprimable — 6.4)
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();
    statutFacture = "VALIDEE";
  } else if (params.montantEncaisse > 0) {
    creerPaiement(db, {
      idFacture: facture.idFacture,
      mode: params.modePaiement ?? "CASH",
      montant: params.montantEncaisse,
      utilisateurId: params.userId,
      banque: params.banque,
      numeroCheque: params.numeroCheque,
      titulaireCheque: params.titulaireCheque,
      dateCheque: params.dateCheque,
      referenceVirement: params.referenceVirement,
    });
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();
    statutFacture = "VALIDEE";
  }

  if (statutFacture === "BROUILLON") {
    enregistrerOperationEnAttente(db, { idFacture: facture.idFacture, numeroAbonnement: params.numeroAbonnement, type: "REABONNEMENT", avant: etatAvant, idHistoriqueAvant: reperHistorique });
  }

  return { numeroAbonnement: params.numeroAbonnement, idFacture: facture.idFacture, jetonVerification: facture.jetonVerification, statutFacture, montantTaxe };
}
