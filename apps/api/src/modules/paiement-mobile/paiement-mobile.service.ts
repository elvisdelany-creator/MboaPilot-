import { eq } from "drizzle-orm";
import { peutTransitionnerPaiementMobile } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import type { FournisseurPaiementMobile, ParcoursPaiementMobile } from "./fournisseur.js";

const DELAI_EXPIRATION_MINUTES = 5; // délai de saisie de l'OTP (6.6)

export interface InitierPaiementMobileParams {
  idFacture: number;
  numeroTelephone: string;
  montant: number;
  parcours: ParcoursPaiementMobile;
}

// 6.6 : initie une transaction de paiement mobile sur une facture existante
// (créée BROUILLON par le flux caisse/SAV concerné, avec montantEncaisse=0).
export async function initierPaiementMobile(db: Db, fournisseur: FournisseurPaiementMobile, params: InitierPaiementMobileParams) {
  const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, params.idFacture)).get();
  if (!facture) throw new Error(`Facture ${params.idFacture} introuvable`);
  if (facture.statut === "VALIDEE") throw new Error("Cette facture est déjà validée");

  const dateExpiration = new Date(Date.now() + DELAI_EXPIRATION_MINUTES * 60 * 1000).toISOString();

  const transaction = db
    .insert(schema.transactionMobileMoney)
    .values({
      idFacture: params.idFacture,
      parcours: params.parcours,
      numeroTelephone: params.numeroTelephone,
      montant: params.montant,
      statut: "INITIEE",
      dateExpiration,
    })
    .returning()
    .get();

  const { referenceFournisseur } = await fournisseur.initier({
    numeroTelephone: params.numeroTelephone,
    montant: params.montant,
    parcours: params.parcours,
  });

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
export async function actualiserStatutTransaction(db: Db, fournisseur: FournisseurPaiementMobile, idTransaction: number) {
  const transaction = trouverTransaction(db, idTransaction);
  if (!transaction) throw new Error(`Transaction ${idTransaction} introuvable`);

  if (transaction.statut !== "EN_ATTENTE" && transaction.statut !== "INITIEE") return transaction;
  if (!transaction.referenceTransaction) return transaction;

  const statutFournisseur = await fournisseur.consulterStatut(transaction.referenceTransaction);
  if (!peutTransitionnerPaiementMobile(transaction.statut, statutFournisseur)) return transaction;

  if (statutFournisseur === "REUSSIE") {
    const paiementExistant = db
      .select()
      .from(schema.paiement)
      .where(eq(schema.paiement.referenceTransaction, transaction.referenceTransaction))
      .get();

    if (!paiementExistant) {
      db.insert(schema.paiement)
        .values({
          idFacture: transaction.idFacture,
          mode: "MOBILE_MONEY",
          montant: transaction.montant,
          referenceTransaction: transaction.referenceTransaction,
        })
        .run();
      db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, transaction.idFacture)).run();
    }
  }

  return db
    .update(schema.transactionMobileMoney)
    .set({ statut: statutFournisseur })
    .where(eq(schema.transactionMobileMoney.idTransaction, idTransaction))
    .returning()
    .get();
}
