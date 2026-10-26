import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { enregistrerMouvement } from "../stock/stock.repository.js";
import { restituerComposantsKit } from "../stock/stock.service.js";

export interface AnnulerFactureEnAttenteParams {
  idFacture: number;
  userId: number;
}

export interface AnnulerFactureEnAttenteResultat {
  idFacture: number;
  montantTotal: number;
}

export interface VenteEnAttente {
  idFacture: number;
  dateCreation: string;
  montantTotal: number;
  client: string | null;
  type: "PRODUITS" | "ABONNEMENT";
  // recrutement jamais payé : l'abonnement qui s'annule avec la facture
  numeroAbonnement: number | null;
  lignes: { libelle: string; quantite: number }[];
  // une transaction Mobile Money est encore ouverte : la vente peut aboutir, elle ne s'annule pas
  paiementEnCours: boolean;
}

type Facture = typeof schema.facture.$inferSelect;
type Nature = { type: "PRODUITS" } | { type: "ABONNEMENT"; numeroAbonnement: number };

const STATUTS_MOBILE_OUVERTS = ["INITIEE", "EN_ATTENTE"] as const;

// 6.4 : une facture BROUILLON « reste modifiable sans restriction » ; 9.1, 11.5 : aucune suppression de vente sans confirmation
// ni traçabilité. Une vente dont le paiement Mobile Money n'a jamais abouti laissait sa facture BROUILLON, son stock sorti et,
// pour un recrutement, un abonnement ACTIF jamais payé. Seules s'annulent ici :
//  - une vente de produits sans aucun encaissement ;
//  - un recrutement sans aucun encaissement, dont l'abonnement n'a connu aucune autre opération.
// Une facture VALIDEE se corrige par un avoir ; réabonnement, changement de formule et échange de matériel modifient un
// abonnement existant : leur facture ne s'annule pas sans défaire cette modification.
function lignesDeFacture(db: Db, idFacture: number) {
  return db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, idFacture)).all();
}

function natureDeLaVente(db: Db, facture: Facture): Nature | null {
  if (facture.type !== "VENTE" || facture.statut !== "BROUILLON") return null;
  if (db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, facture.idFacture)).get()) return null;
  if (db.select().from(schema.savDossier).where(eq(schema.savDossier.idFacture, facture.idFacture)).get()) return null;

  const lignes = lignesDeFacture(db, facture.idFacture);
  if (lignes.length === 0) return null;

  const uniquementProduits = lignes.every((l) => l.idProduit !== null && l.idKit === null && l.idOption === null && l.numeroAbonnement === null);
  if (uniquementProduits) return { type: "PRODUITS" };

  // recrutement : formule, kit et options d'un seul abonnement, sans article de stock isolé
  if (lignes.some((l) => l.idProduit !== null || (l.numeroAbonnement === null && l.idKit === null))) return null;
  const numeros = new Set(lignes.map((l) => l.numeroAbonnement).filter((n): n is number => n !== null));
  if (numeros.size !== 1) return null;
  const numeroAbonnement = [...numeros][0];
  if (!db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get()) return null;

  const autresLignes = db
    .select()
    .from(schema.ligneVente)
    .where(and(eq(schema.ligneVente.numeroAbonnement, numeroAbonnement), ne(schema.ligneVente.idFacture, facture.idFacture)))
    .get();
  if (autresLignes) return null;
  if (db.select().from(schema.historiqueAbonnement).where(eq(schema.historiqueAbonnement.numeroAbonnement, numeroAbonnement)).get()) return null;
  if (db.select().from(schema.suiviCommissionCanalplus).where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, numeroAbonnement)).get()) return null;
  return { type: "ABONNEMENT", numeroAbonnement };
}

// Le statut d'une transaction n'est actualisé qu'à la demande (paiement-mobile.service.ts) : c'est la date d'expiration qui dit
// si elle peut encore aboutir. Jugée sur le seul statut, une transaction abandonnée bloquerait l'annulation pour toujours.
function paiementMobileOuvert(db: Db, idFacture: number): boolean {
  return db
    .select()
    .from(schema.transactionMobileMoney)
    .where(and(eq(schema.transactionMobileMoney.idFacture, idFacture), inArray(schema.transactionMobileMoney.statut, [...STATUTS_MOBILE_OUVERTS])))
    .all()
    .some((t) => new Date(t.dateExpiration).getTime() > Date.now());
}

export function annulerFactureEnAttente(db: Db, params: AnnulerFactureEnAttenteParams): AnnulerFactureEnAttenteResultat {
  // atomique : stock restitué, trace d'audit et suppressions s'écrivent ensemble
  return db.transaction(() => {
    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, params.idFacture)).get();
    if (!facture) throw new Error(`Facture ${params.idFacture} introuvable`);
    if (facture.type === "AVOIR") throw new Error("Un avoir ne s'annule pas : il corrige déjà une facture");
    if (facture.statut === "VALIDEE") {
      throw new Error("Cette facture est déjà encaissée : elle se corrige par un avoir, pas par une annulation");
    }
    const nature = natureDeLaVente(db, facture);
    if (!nature) {
      throw new Error(
        "Seule une vente de produits ou un recrutement sans encaissement peut être annulé : cette facture porte un réabonnement, un changement d'abonnement, un échange de matériel ou un dossier SAV"
      );
    }
    if (paiementMobileOuvert(db, facture.idFacture)) {
      throw new Error("Un paiement Mobile Money est en cours sur cette vente : attendez son résultat avant de l'annuler");
    }

    const lignes = lignesDeFacture(db, facture.idFacture);
    const transactions = db.select().from(schema.transactionMobileMoney).where(eq(schema.transactionMobileMoney.idFacture, facture.idFacture)).all();
    const motif = `Annulation de la vente en attente (facture n° ${facture.idFacture})`;

    const abonnement =
      nature.type === "ABONNEMENT"
        ? db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, nature.numeroAbonnement)).get()
        : undefined;
    const materiels = abonnement ? db.select().from(schema.materielAbonne).where(eq(schema.materielAbonne.numeroAbonnement, abonnement.numeroAbonnement)).all() : [];
    const commissionEnAttente = db.select().from(schema.commissionCanalplusEnAttente).where(eq(schema.commissionCanalplusEnAttente.idFacture, facture.idFacture)).get();

    db.insert(schema.journalAudit)
      .values({
        utilisateurId: params.userId,
        action: "SUPPRESSION",
        tableCible: "facture",
        idCible: String(facture.idFacture),
        valeurAvant: JSON.stringify({ ...facture, lignes, transactionsMobileMoney: transactions, abonnement, materiels, commissionEnAttente }),
      })
      .run();

    for (const ligne of lignes) {
      if (ligne.idKit !== null) {
        restituerComposantsKit(db, { idKit: ligne.idKit, siteId: facture.siteId, userId: params.userId, quantiteKits: ligne.quantite });
      } else if (ligne.idProduit !== null) {
        const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, ligne.idProduit)).get();
        if (produit?.suiviStock === 1) {
          enregistrerMouvement(db, { idProduit: produit.idProduit, siteId: facture.siteId, typeMouvement: "RETOUR_CLIENT", quantite: ligne.quantite, motif, utilisateurId: params.userId });
        }
      }
    }

    db.delete(schema.commissionCanalplusEnAttente).where(eq(schema.commissionCanalplusEnAttente.idFacture, facture.idFacture)).run();
    db.delete(schema.transactionMobileMoney).where(eq(schema.transactionMobileMoney.idFacture, facture.idFacture)).run();
    db.delete(schema.ligneVente).where(eq(schema.ligneVente.idFacture, facture.idFacture)).run();
    db.delete(schema.facture).where(eq(schema.facture.idFacture, facture.idFacture)).run();
    if (abonnement) {
      db.delete(schema.materielAbonne).where(eq(schema.materielAbonne.numeroAbonnement, abonnement.numeroAbonnement)).run();
      db.delete(schema.alerteEcheance).where(eq(schema.alerteEcheance.numeroAbonnement, abonnement.numeroAbonnement)).run();
      db.delete(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, abonnement.numeroAbonnement)).run();
    }

    return { idFacture: facture.idFacture, montantTotal: facture.montantTotal };
  });
}

function libelleLigne(db: Db, ligne: typeof schema.ligneVente.$inferSelect): string {
  if (ligne.idProduit !== null) return db.select().from(schema.produit).where(eq(schema.produit.idProduit, ligne.idProduit)).get()?.libelle ?? "Article supprimé";
  if (ligne.idKit !== null) return db.select().from(schema.kit).where(eq(schema.kit.idKit, ligne.idKit)).get()?.libelle ?? "Kit supprimé";
  if (ligne.idOption !== null) return db.select().from(schema.optionComplement).where(eq(schema.optionComplement.idOption, ligne.idOption)).get()?.libelle ?? "Option supprimée";
  const abonnement = ligne.numeroAbonnement !== null ? db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, ligne.numeroAbonnement)).get() : undefined;
  const formule = abonnement ? db.select().from(schema.formule).where(eq(schema.formule.idFormule, abonnement.idFormule)).get() : undefined;
  const famille = formule ? db.select().from(schema.familleAbonnement).where(eq(schema.familleAbonnement.idFamille, formule.idFamille)).get() : undefined;
  return formule ? `${famille ? `${famille.libelle} ` : ""}${formule.libelle}` : "Abonnement";
}

// Les ventes jamais encaissées d'un site : sans client elles n'apparaissent dans aucune fiche, leur stock reste sorti et un
// recrutement garde un abonnement ACTIF non payé.
export function listerVentesEnAttente(db: Db, siteId: number): VenteEnAttente[] {
  const brouillons = db
    .select()
    .from(schema.facture)
    .where(and(eq(schema.facture.siteId, siteId), eq(schema.facture.statut, "BROUILLON"), eq(schema.facture.type, "VENTE")))
    .orderBy(desc(schema.facture.idFacture))
    .all();

  const ventes: VenteEnAttente[] = [];
  for (const facture of brouillons) {
    const nature = natureDeLaVente(db, facture);
    if (!nature) continue;
    const abonne = facture.idAbonne ? db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, facture.idAbonne)).get() : undefined;
    ventes.push({
      idFacture: facture.idFacture,
      dateCreation: facture.dateCreation,
      montantTotal: facture.montantTotal,
      client: abonne ? `${abonne.prenom} ${abonne.nom}`.trim() : null,
      type: nature.type,
      numeroAbonnement: nature.type === "ABONNEMENT" ? nature.numeroAbonnement : null,
      lignes: lignesDeFacture(db, facture.idFacture).map((ligne) => ({ libelle: libelleLigne(db, ligne), quantite: ligne.quantite })),
      paiementEnCours: paiementMobileOuvert(db, facture.idFacture),
    });
  }
  return ventes;
}
