import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { enregistrerMouvement } from "../stock/stock.repository.js";

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
  lignes: { libelle: string; quantite: number }[];
  // une transaction Mobile Money est encore ouverte : la vente peut aboutir, elle ne s'annule pas
  paiementEnCours: boolean;
}

const STATUTS_MOBILE_OUVERTS = ["INITIEE", "EN_ATTENTE"] as const;

// 6.4 : une facture BROUILLON « reste modifiable sans restriction » ; 9.1, 11.5 : aucune suppression de vente sans confirmation
// ni traçabilité. Une vente de produits dont le paiement Mobile Money n'a jamais abouti laissait sa facture BROUILLON et son
// stock sorti pour toujours. Seule une vente de produits sans aucun encaissement s'annule ici : une facture VALIDEE se corrige
// par un avoir, et une facture d'abonnement ou de SAV a d'autres effets (abonnement, commission, dossier) à défaire avec elle.
function lignesDeFacture(db: Db, idFacture: number) {
  return db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, idFacture)).all();
}

function estVenteDeProduitsEnAttente(db: Db, facture: typeof schema.facture.$inferSelect): boolean {
  if (facture.type !== "VENTE" || facture.statut !== "BROUILLON") return false;
  if (db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, facture.idFacture)).get()) return false;
  const lignes = lignesDeFacture(db, facture.idFacture);
  if (lignes.length === 0 || lignes.some((l) => l.idProduit === null || l.idKit !== null || l.idOption !== null || l.numeroAbonnement !== null)) return false;
  return !db.select().from(schema.savDossier).where(eq(schema.savDossier.idFacture, facture.idFacture)).get();
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
  // atomique : stock restitué, trace d'audit et suppression s'écrivent ensemble
  return db.transaction(() => {
    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, params.idFacture)).get();
    if (!facture) throw new Error(`Facture ${params.idFacture} introuvable`);
    if (facture.type === "AVOIR") throw new Error("Un avoir ne s'annule pas : il corrige déjà une facture");
    if (facture.statut === "VALIDEE") {
      throw new Error("Cette facture est déjà encaissée : elle se corrige par un avoir, pas par une annulation");
    }
    if (!estVenteDeProduitsEnAttente(db, facture)) {
      throw new Error("Seule une vente de produits sans encaissement peut être annulée : cette facture porte un abonnement, un kit ou un dossier SAV");
    }
    if (paiementMobileOuvert(db, facture.idFacture)) {
      throw new Error("Un paiement Mobile Money est en cours sur cette vente : attendez son résultat avant de l'annuler");
    }

    const lignes = lignesDeFacture(db, facture.idFacture);
    const transactions = db.select().from(schema.transactionMobileMoney).where(eq(schema.transactionMobileMoney.idFacture, facture.idFacture)).all();

    db.insert(schema.journalAudit)
      .values({
        utilisateurId: params.userId,
        action: "SUPPRESSION",
        tableCible: "facture",
        idCible: String(facture.idFacture),
        valeurAvant: JSON.stringify({ ...facture, lignes, transactionsMobileMoney: transactions }),
      })
      .run();

    for (const ligne of lignes) {
      const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, ligne.idProduit!)).get();
      if (produit?.suiviStock === 1) {
        enregistrerMouvement(db, {
          idProduit: produit.idProduit,
          siteId: facture.siteId,
          typeMouvement: "RETOUR_CLIENT",
          quantite: ligne.quantite,
          motif: `Annulation de la vente en attente (facture n° ${facture.idFacture})`,
          utilisateurId: params.userId,
        });
      }
    }

    db.delete(schema.transactionMobileMoney).where(eq(schema.transactionMobileMoney.idFacture, facture.idFacture)).run();
    db.delete(schema.ligneVente).where(eq(schema.ligneVente.idFacture, facture.idFacture)).run();
    db.delete(schema.facture).where(eq(schema.facture.idFacture, facture.idFacture)).run();

    return { idFacture: facture.idFacture, montantTotal: facture.montantTotal };
  });
}

// Les ventes de produits jamais encaissées d'un site : sans client elles n'apparaissent dans aucune fiche, et leur stock reste sorti.
export function listerVentesEnAttente(db: Db, siteId: number): VenteEnAttente[] {
  const brouillons = db
    .select()
    .from(schema.facture)
    .where(and(eq(schema.facture.siteId, siteId), eq(schema.facture.statut, "BROUILLON"), eq(schema.facture.type, "VENTE")))
    .orderBy(desc(schema.facture.idFacture))
    .all();

  return brouillons
    .filter((facture) => estVenteDeProduitsEnAttente(db, facture))
    .map((facture) => {
      const abonne = facture.idAbonne ? db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, facture.idAbonne)).get() : undefined;
      return {
        idFacture: facture.idFacture,
        dateCreation: facture.dateCreation,
        montantTotal: facture.montantTotal,
        client: abonne ? `${abonne.prenom} ${abonne.nom}`.trim() : null,
        lignes: lignesDeFacture(db, facture.idFacture).map((ligne) => ({
          libelle: db.select().from(schema.produit).where(eq(schema.produit.idProduit, ligne.idProduit!)).get()?.libelle ?? "Article supprimé",
          quantite: ligne.quantite,
        })),
        paiementEnCours: paiementMobileOuvert(db, facture.idFacture),
      };
    });
}
