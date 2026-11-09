import { asc, eq } from "drizzle-orm";
import { ligneAvecRemise, type LigneMontant } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface PaiementRecu {
  mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";
  montant: number;
  dateHeure: string;
}

export interface RecuFacture {
  idFacture: number;
  dateHeure: string;
  numeroAbonnement: number | null;
  lignes: LigneMontant[];
  total: number;
  // figé sur la facture à sa création, jamais recalculé avec le taux courant
  montantTaxe: number;
  // 13.1 : QR code de vérification
  jetonVerification: string;
  paiements: PaiementRecu[];
}

// 6.7 : un client qui a perdu son ticket revient avec sa facture : le reçu d'une facture DÉJÀ ENCAISSÉE se reconstitue à l'identique de celui
// de la caisse (mêmes libellés, prix catalogue puis remise, taxe figée, QR), pour être réimprimé avec la mention DUPLICATA.
// Jamais une facture sans encaissement (6.4, règle 2), ni un avoir : seul le reçu d'une vente se réimprime.
export function construireRecuFacture(db: Db, idFacture: number): RecuFacture {
  const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
  if (!facture) throw new Error(`Facture ${idFacture} introuvable`);
  if (facture.type !== "VENTE") throw new Error("Seul le reçu d'une vente peut être réimprimé");
  if (facture.statut !== "VALIDEE") throw new Error("Une facture sans encaissement ne s'imprime pas : encaissez-la d'abord");

  const lignes = db
    .select({
      ligne: schema.ligneVente,
      libelleProduit: schema.produit.libelle,
      libelleKit: schema.kit.libelle,
      libelleOption: schema.optionComplement.libelle,
      libelleFormule: schema.formule.libelle,
    })
    .from(schema.ligneVente)
    .leftJoin(schema.produit, eq(schema.ligneVente.idProduit, schema.produit.idProduit))
    .leftJoin(schema.kit, eq(schema.ligneVente.idKit, schema.kit.idKit))
    .leftJoin(schema.optionComplement, eq(schema.ligneVente.idOption, schema.optionComplement.idOption))
    .leftJoin(schema.abonnement, eq(schema.ligneVente.numeroAbonnement, schema.abonnement.numeroAbonnement))
    .leftJoin(schema.formule, eq(schema.abonnement.idFormule, schema.formule.idFormule))
    .where(eq(schema.ligneVente.idFacture, idFacture))
    .orderBy(asc(schema.ligneVente.idLigne))
    .all();

  const lignesRecu = lignes.flatMap(({ ligne, libelleProduit, libelleKit, libelleOption, libelleFormule }) => {
    // mêmes libellés qu'à la caisse : article × quantité, « kit — matériel », option, sinon la formule de l'abonnement
    const libelle = libelleProduit
      ? ligne.quantite > 1
        ? `${libelleProduit} × ${ligne.quantite}`
        : libelleProduit
      : libelleKit
        ? `${libelleKit} — matériel`
        : (libelleOption ?? libelleFormule ?? "Article");
    // prix_applique est le net facturé : le prix catalogue de la ligne est net + remise
    return ligneAvecRemise(libelle, ligne.prixApplique + ligne.remise, ligne.remise, libelleProduit ? `Remise — ${libelleProduit}` : "Remise");
  });

  const paiements = db
    .select()
    .from(schema.paiement)
    .where(eq(schema.paiement.idFacture, idFacture))
    .orderBy(asc(schema.paiement.idPaiement))
    .all()
    // le remboursement d'un avoir est enregistré sur la facture d'origine, en négatif : il ne fait pas partie du reçu de la vente
    .filter((p) => p.montant > 0)
    .map((p) => ({ mode: p.mode, montant: p.montant, dateHeure: p.datePaiement }));

  return {
    idFacture: facture.idFacture,
    dateHeure: facture.dateCreation,
    numeroAbonnement: lignes.find((l) => l.ligne.numeroAbonnement !== null)?.ligne.numeroAbonnement ?? null,
    lignes: lignesRecu,
    total: facture.montantTotal,
    montantTaxe: facture.montantTaxe,
    jetonVerification: facture.jetonVerification,
    paiements,
  };
}
