import { eq, sql } from "drizzle-orm";
import { peutTransitionnerPaiementMobile } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import type { FournisseurPaiementMobile, ParcoursPaiementMobile } from "./fournisseur.js";
import { creerSuiviCommissionCanalplus } from "../abonnements/suivi-commission-canalplus.repository.js";
import { verifierEntier } from "../../lib/validation.js";
import { telephoneObligatoire } from "../../lib/champs-texte.js";

const DELAI_EXPIRATION_MINUTES = 5; // délai de saisie de l'OTP (6.6)
const MONTANT_MAX = 1_000_000_000;

// espaces simples (et non l'espace fine insécable d'Intl) : le message s'affiche tel quel
const formaterFcfa = (montant: number) => String(montant).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// 9.4, 6.4 : ce que le client doit encore sur la facture — total, moins les avoirs émis dessus (montants
// négatifs), moins les paiements déjà encaissés
function soldeDuFacture(db: Db, facture: typeof schema.facture.$inferSelect): number {
  const paye = db.select({ total: sql<number>`coalesce(sum(${schema.paiement.montant}), 0)` }).from(schema.paiement).where(eq(schema.paiement.idFacture, facture.idFacture)).get();
  const avoirs = db.select({ total: sql<number>`coalesce(sum(${schema.facture.montantTotal}), 0)` }).from(schema.facture).where(eq(schema.facture.factureOrigineId, facture.idFacture)).get();
  return facture.montantTotal + Number(avoirs?.total ?? 0) - Number(paye?.total ?? 0);
}

export interface InitierPaiementMobileParams {
  idFacture: number;
  numeroTelephone: string;
  montant: number;
  parcours: ParcoursPaiementMobile;
}

// 6.6 : initie une transaction de paiement mobile sur une facture existante : créée BROUILLON par le flux caisse/SAV
// concerné (montantEncaisse=0), ou déjà VALIDEE avec un solde restant dû (acompte encaissé par un autre moyen).
export async function initierPaiementMobile(db: Db, fournisseur: FournisseurPaiementMobile, params: InitierPaiementMobileParams) {
  verifierEntier(params.montant, "Le montant du paiement mobile", { min: 1, max: MONTANT_MAX, requis: true, nullable: false, message: "Le montant du paiement mobile doit être positif" });
  const numeroTelephone = telephoneObligatoire(params.numeroTelephone, "Le numéro de téléphone du paiement mobile");
  if (params.parcours !== "USSD_CLIENT" && params.parcours !== "PUSH_MARCHAND") throw new Error("Le parcours de paiement mobile est invalide (USSD_CLIENT ou PUSH_MARCHAND)");

  const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, params.idFacture)).get();
  if (!facture) throw new Error(`Facture ${params.idFacture} introuvable`);
  if (facture.type === "AVOIR") throw new Error("Une facture d'avoir ne peut pas être payée par Mobile Money");
  // un client débité au-delà de ce qu'il doit n'est remboursable que par un avoir : on refuse en amont
  const solde = soldeDuFacture(db, facture);
  // une facture VALIDEE (acompte déjà encaissé) peut régler son solde par Mobile Money ; seule une facture soldée est refusée
  if (facture.statut === "VALIDEE" && solde <= 0) throw new Error("Cette facture est déjà soldée");
  if (params.montant > solde) throw new Error(`Le montant (${formaterFcfa(params.montant)} FCFA) dépasse le solde dû de la facture (${formaterFcfa(Math.max(0, solde))} FCFA)`);

  // 6.6 : une seule transaction à la fois par facture — sinon deux
  // confirmations aboutissent et le client est débité deux fois. Jugé sur la
  // date d'expiration réelle (et non sur le seul statut, actualisé à la
  // demande) pour qu'un client dont le code n'a pas été saisi puisse réessayer.
  const enAttente = db
    .select()
    .from(schema.transactionMobileMoney)
    .where(eq(schema.transactionMobileMoney.idFacture, params.idFacture))
    .all()
    .some((t) => (t.statut === "INITIEE" || t.statut === "EN_ATTENTE") && new Date(t.dateExpiration).getTime() > Date.now());
  if (enAttente) throw new Error("Un paiement Mobile Money est déjà en attente de confirmation pour cette facture");

  const dateExpiration = new Date(Date.now() + DELAI_EXPIRATION_MINUTES * 60 * 1000).toISOString();

  const transaction = db
    .insert(schema.transactionMobileMoney)
    .values({
      idFacture: params.idFacture,
      parcours: params.parcours,
      numeroTelephone,
      montant: params.montant,
      statut: "INITIEE",
      dateExpiration,
    })
    .returning()
    .get();

  let referenceFournisseur: string;
  try {
    ({ referenceFournisseur } = await fournisseur.initier({ numeroTelephone, montant: params.montant, parcours: params.parcours }));
  } catch (erreur) {
    // fournisseur injoignable : sans cela la transaction restait INITIEE et bloquait toute nouvelle
    // tentative pendant le délai d'expiration, et le message technique arrivait jusqu'au caissier
    console.error("[API] échec de l'initiation du paiement Mobile Money", erreur);
    db.update(schema.transactionMobileMoney).set({ statut: "ECHOUEE" }).where(eq(schema.transactionMobileMoney.idTransaction, transaction.idTransaction)).run();
    throw new Error("Orange Money n'a pas pu être joint pour le moment — réessayez dans un instant");
  }

  return db
    .update(schema.transactionMobileMoney)
    .set({ statut: "EN_ATTENTE", referenceTransaction: referenceFournisseur })
    .where(eq(schema.transactionMobileMoney.idTransaction, transaction.idTransaction))
    .returning()
    .get();
}

export function trouverTransaction(db: Db, idTransaction: number) {
  return db.select().from(schema.transactionMobileMoney).where(eq(schema.transactionMobileMoney.idTransaction, idTransaction)).get();
}

// 6.6 : interroge le fournisseur (polling) et applique la transition — le
// callback/webhook officiel viendra remplacer cet appel manuel sans changer
// la logique métier ci-dessous. Idempotent : un état terminal ne rappelle
// jamais le fournisseur ni ne recrée de paiement.
export async function actualiserStatutTransaction(db: Db, fournisseur: FournisseurPaiementMobile, idTransaction: number, userId: number) {
  const transaction = trouverTransaction(db, idTransaction);
  if (!transaction) throw new Error(`Transaction ${idTransaction} introuvable`);

  if (transaction.statut !== "EN_ATTENTE" && transaction.statut !== "INITIEE") return transaction;

  // 6.6 : "EXPIRÉE : Délai de validation dépassé (OTP non saisi à temps) :
  // la transaction est annulée" — vérifié avant toute consultation du
  // fournisseur, qui peut ne jamais se prononcer sur une transaction
  // abandonnée par le client (ex. USSD fermé sans saisir l'OTP).
  if (new Date(transaction.dateExpiration).getTime() <= Date.now()) {
    return db
      .update(schema.transactionMobileMoney)
      .set({ statut: "EXPIREE" })
      .where(eq(schema.transactionMobileMoney.idTransaction, idTransaction))
      .returning()
      .get();
  }

  if (!transaction.referenceTransaction) return transaction;

  const statutFournisseur = await fournisseur.consulterStatut(transaction.referenceTransaction);
  if (!peutTransitionnerPaiementMobile(transaction.statut, statutFournisseur)) return transaction;

  const referenceFournisseurTransaction = transaction.referenceTransaction; // déjà vérifiée non nulle plus haut
  // atomique : le paiement, la validation de la facture, la promotion de la commission et le statut de la
  // transaction s'écrivent ensemble — un échec laissait un paiement sans facture validée
  return db.transaction(() => {
    if (statutFournisseur === "REUSSIE") {
      const paiementExistant = db
        .select()
        .from(schema.paiement)
        .where(eq(schema.paiement.referenceTransaction, referenceFournisseurTransaction))
        .get();

      if (!paiementExistant) {
        db.insert(schema.paiement)
          .values({
            idFacture: transaction.idFacture,
            mode: "MOBILE_MONEY",
            montant: transaction.montant,
            utilisateurId: userId,
            referenceTransaction: referenceFournisseurTransaction,
          })
          .run();
        db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, transaction.idFacture)).run();

        // 6.2, 6.6 : promeut la commission CANAL+ calculée au recrutement
        // (mise en attente car le paiement était différé) en un vrai suivi,
        // maintenant que la facture est réellement VALIDEE.
        const enAttente = db
          .select()
          .from(schema.commissionCanalplusEnAttente)
          .where(eq(schema.commissionCanalplusEnAttente.idFacture, transaction.idFacture))
          .get();
        if (enAttente) {
          creerSuiviCommissionCanalplus(db, {
            numeroAbonnement: enAttente.numeroAbonnement,
            vendeurId: enAttente.vendeurId,
            apporteurId: enAttente.apporteurId ?? undefined,
            montantCommission: enAttente.montantCommission,
            dateFinProbatoire: enAttente.dateFinProbatoire,
          });
          db.delete(schema.commissionCanalplusEnAttente).where(eq(schema.commissionCanalplusEnAttente.idFacture, transaction.idFacture)).run();
        }
      }
    }

    return db
      .update(schema.transactionMobileMoney)
      .set({ statut: statutFournisseur })
      .where(eq(schema.transactionMobileMoney.idTransaction, idTransaction))
      .returning()
      .get();
  });
}
