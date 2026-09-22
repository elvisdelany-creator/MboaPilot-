import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface CreerPaiementParams {
  idFacture: number;
  mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";
  montant: number;
  utilisateurId: number;
  referenceTransaction?: string;
  banque?: string;
  numeroCheque?: string;
  titulaireCheque?: string;
  dateCheque?: string;
  referenceVirement?: string;
}

// 6.5 : "Comptant" et "Chèque" ont une validation "Immédiate" ; seul le
// "Virement bancaire" est "Différée (rapprochement)" — un virement démarre
// donc EN_ATTENTE de rapprochement, les autres modes n'ont aucun statut
// (null, notion non applicable).
export function creerPaiement(db: Db, params: CreerPaiementParams) {
  return db
    .insert(schema.paiement)
    .values({
      idFacture: params.idFacture,
      mode: params.mode,
      montant: params.montant,
      utilisateurId: params.utilisateurId,
      referenceTransaction: params.referenceTransaction,
      banque: params.banque,
      numeroCheque: params.numeroCheque,
      titulaireCheque: params.titulaireCheque,
      dateCheque: params.dateCheque,
      referenceVirement: params.referenceVirement,
      statutRapprochement: params.mode === "VIREMENT" ? "EN_ATTENTE" : null,
    })
    .returning()
    .get();
}

export function listerPaiementsFacture(db: Db, idFacture: number) {
  return db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, idFacture)).all();
}

// 6.5 : confirmation manuelle du rapprochement bancaire d'un virement, une
// fois le relevé de banque vérifié — geste réservé à l'encadrement/finance
// (guard gestionRapprochement, app.ts), jamais automatique.
export function confirmerRapprochementVirement(db: Db, idPaiement: number) {
  const paiement = db.select().from(schema.paiement).where(eq(schema.paiement.idPaiement, idPaiement)).get();
  if (!paiement) throw new Error(`Paiement ${idPaiement} introuvable`);
  if (paiement.mode !== "VIREMENT") throw new Error("Seul un paiement par virement peut faire l'objet d'un rapprochement");
  if (paiement.statutRapprochement === "RAPPROCHE") throw new Error("Ce virement est déjà rapproché");

  return db.update(schema.paiement).set({ statutRapprochement: "RAPPROCHE" }).where(eq(schema.paiement.idPaiement, idPaiement)).returning().get();
}
