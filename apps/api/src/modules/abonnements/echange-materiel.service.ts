import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { enregistrerMouvement } from "../stock/stock.repository.js";

export interface EchangerMaterielParams {
  siteId: number;
  userId: number;
  numeroAbonnement: number;
  idProduit: number; // référence catalogue du matériel de remplacement
  typeMateriel: string; // ex. DECODEUR, PARABOLE, CARTE_ACCES
  numeroSerie?: string;
  sousGarantie: boolean;
  motif: string; // ex. "panne", "vol"
  montantEncaisse: number;
}

export interface EchangeMaterielResultat {
  idMateriel: number;
  idFacture: number;
  montantFacture: number;
  statutFacture: "BROUILLON" | "VALIDEE";
}

// 7.3 : remplacement du matériel d'un abonné (panne/vol). Le numéro
// d'abonnement est conservé par défaut — la politique opérateur qui
// imposerait un nouveau numéro (3.2.2) est laissée à la couche appelante,
// non tranchée arbitrairement ici.
export function echangerMateriel(db: Db, params: EchangerMaterielParams): EchangeMaterielResultat {
  const abonnement = db
    .select()
    .from(schema.abonnement)
    .where(eq(schema.abonnement.numeroAbonnement, params.numeroAbonnement))
    .get();
  if (!abonnement) throw new Error(`Abonnement ${params.numeroAbonnement} introuvable`);

  const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, params.idProduit)).get();
  if (!produit) throw new Error(`Produit ${params.idProduit} introuvable`);

  const ancienMateriel = db
    .select()
    .from(schema.materielAbonne)
    .where(eq(schema.materielAbonne.numeroAbonnement, params.numeroAbonnement))
    .all()
    .filter((m) => m.statut === "ACTIF");

  for (const m of ancienMateriel) {
    db.update(schema.materielAbonne).set({ statut: "REMPLACE" }).where(eq(schema.materielAbonne.idMateriel, m.idMateriel)).run();
  }

  const nouveauMateriel = db
    .insert(schema.materielAbonne)
    .values({
      numeroAbonnement: params.numeroAbonnement,
      typeMateriel: params.typeMateriel,
      numeroSerie: params.numeroSerie,
    })
    .returning()
    .get();

  // 5.2 : le matériel de remplacement sort du stock du site, comme toute vente
  if (produit.suiviStock === 1) {
    enregistrerMouvement(db, {
      idProduit: params.idProduit,
      siteId: params.siteId,
      typeMouvement: "VENTE",
      quantite: 1,
      motif: `Échange matériel — abonnement n° ${params.numeroAbonnement}`,
      utilisateurId: params.userId,
    });
  }

  // 3.2.2 : historique des changements de matériel — numéros de série successifs, motif, garantie
  db.insert(schema.historiqueAbonnement)
    .values({
      numeroAbonnement: params.numeroAbonnement,
      typeChangement: "MATERIEL",
      valeurAvant: ancienMateriel.map((m) => m.numeroSerie).join(", ") || null,
      valeurApres: params.numeroSerie ?? null,
      motif: params.motif,
      utilisateurId: params.userId,
    })
    .run();

  // 7.3 : gratuit sous garantie, tarif plein sinon
  const montantFacture = params.sousGarantie ? 0 : produit.prixVente;

  const facture = db
    .insert(schema.facture)
    .values({ siteId: params.siteId, idAbonne: abonnement.idAbonne, creePar: params.userId, montantTotal: montantFacture })
    .returning()
    .get();

  db.insert(schema.ligneVente)
    .values({
      idFacture: facture.idFacture,
      idProduit: params.idProduit,
      numeroAbonnement: params.numeroAbonnement,
      prixApplique: montantFacture,
    })
    .run();

  let statutFacture: "BROUILLON" | "VALIDEE" = "BROUILLON";
  if (montantFacture === 0) {
    // rien à encaisser : aucune friction de caisse pour une facture à 0 FCFA
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();
    statutFacture = "VALIDEE";
  } else if (params.montantEncaisse > 0) {
    db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: params.montantEncaisse }).run();
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();
    statutFacture = "VALIDEE";
  }

  return { idMateriel: nouveauMateriel.idMateriel, idFacture: facture.idFacture, montantFacture, statutFacture };
}
