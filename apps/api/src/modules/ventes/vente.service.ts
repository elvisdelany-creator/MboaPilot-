import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { enregistrerMouvement } from "../stock/stock.repository.js";

export interface LigneVenteProduitInput {
  idProduit: number;
  quantite: number;
}

export interface CreerVenteProduitsParams {
  siteId: number;
  userId: number;
  idAbonne?: number;
  lignes: LigneVenteProduitInput[];
  montantEncaisse: number;
}

export interface VenteResultat {
  idFacture: number;
  statutFacture: "BROUILLON" | "VALIDEE";
  montantTotal: number;
}

// 5.2, 5.3, 8.5, 9.2 : vente rapide de produits physiques et services hors
// abonnement — décrémente le stock des produits suivis et génère la facture
// et ses lignes de vente (5.2, tableau des mouvements de stock).
export function creerVenteProduits(db: Db, params: CreerVenteProduitsParams): VenteResultat {
  if (params.lignes.length === 0) throw new Error("La vente doit comporter au moins un article");

  const lignesResolues = params.lignes.map((ligne) => {
    if (ligne.quantite <= 0) throw new Error("La quantité doit être positive");
    const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, ligne.idProduit)).get();
    if (!produit) throw new Error(`Produit ${ligne.idProduit} introuvable`);
    return { produit, quantite: ligne.quantite, prixApplique: produit.prixVente * ligne.quantite };
  });

  const montantTotal = lignesResolues.reduce((somme, l) => somme + l.prixApplique, 0);

  const facture = db
    .insert(schema.facture)
    .values({ siteId: params.siteId, idAbonne: params.idAbonne, creePar: params.userId, montantTotal })
    .returning()
    .get();

  for (const ligne of lignesResolues) {
    db.insert(schema.ligneVente)
      .values({ idFacture: facture.idFacture, idProduit: ligne.produit.idProduit, quantite: ligne.quantite, prixApplique: ligne.prixApplique })
      .run();

    if (ligne.produit.suiviStock === 1) {
      enregistrerMouvement(db, {
        idProduit: ligne.produit.idProduit,
        siteId: params.siteId,
        typeMouvement: "VENTE",
        quantite: ligne.quantite,
        utilisateurId: params.userId,
      });
    }
  }

  let statutFacture: "BROUILLON" | "VALIDEE" = "BROUILLON";

  // 6.4 : dès qu'un encaissement (même partiel) est enregistré, la facture devient VALIDEE
  if (params.montantEncaisse > 0) {
    db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: params.montantEncaisse }).run();
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();
    statutFacture = "VALIDEE";
  }

  return { idFacture: facture.idFacture, statutFacture, montantTotal };
}
