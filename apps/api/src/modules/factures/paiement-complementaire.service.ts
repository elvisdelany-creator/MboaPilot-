import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface EncaisserSoldeParams {
  idFacture: number;
  userId: number;
  montant: number;
  // 6.5 : moyen de paiement de l'encaissement — comptant par défaut
  modePaiement?: "CASH" | "CHEQUE" | "VIREMENT";
  banque?: string; // chèque : "Banque" ; virement : "Banque émettrice"
  numeroCheque?: string;
  titulaireCheque?: string;
  dateCheque?: string;
  referenceVirement?: string;
}

export interface EncaisserSoldeResultat {
  idFacture: number;
  montantEncaisse: number;
  soldeRestant: number;
  statutFacture: "VALIDEE";
}

// 6.4 point 5, 9.4 : "Dès qu'un encaissement (même partiel) est enregistré,
// la facture passe au statut VALIDÉE... un solde restant dû reste visible et
// peut faire l'objet d'encaissements complémentaires ultérieurs" — jusqu'ici
// seul le parcours SAV LIVRE (sav.service.ts) permettait de compléter un
// encaissement ; ceci généralise le geste à n'importe quelle facture.
export function encaisserSoldeFacture(db: Db, params: EncaisserSoldeParams): EncaisserSoldeResultat {
  const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, params.idFacture)).get();
  if (!facture) throw new Error(`Facture ${params.idFacture} introuvable`);
  if (facture.type === "AVOIR") throw new Error("Un avoir ne peut pas faire l'objet d'un encaissement complémentaire");
  if (params.montant <= 0) throw new Error("Le montant encaissé doit être positif");

  const totalPaye =
    db
      .select({ total: sql<number>`coalesce(sum(${schema.paiement.montant}), 0)` })
      .from(schema.paiement)
      .where(eq(schema.paiement.idFacture, params.idFacture))
      .get()?.total ?? 0;
  const solde = facture.montantTotal - totalPaye;
  if (solde <= 0) throw new Error("Cette facture est déjà intégralement encaissée");

  db.insert(schema.paiement)
    .values({
      idFacture: params.idFacture,
      mode: params.modePaiement ?? "CASH",
      montant: params.montant,
      utilisateurId: params.userId,
      banque: params.banque,
      numeroCheque: params.numeroCheque,
      titulaireCheque: params.titulaireCheque,
      dateCheque: params.dateCheque,
      referenceVirement: params.referenceVirement,
    })
    .run();

  if (facture.statut === "BROUILLON") {
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, params.idFacture)).run();
  }

  return {
    idFacture: params.idFacture,
    montantEncaisse: params.montant,
    soldeRestant: Math.max(solde - params.montant, 0),
    statutFacture: "VALIDEE",
  };
}
