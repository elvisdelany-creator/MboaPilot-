import { eq } from "drizzle-orm";
import { peutTransitionnerSav, type StatutSav } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { enregistrerMouvement } from "../stock/stock.repository.js";
import { envoyerNotificationAbonne } from "../notifications/notification.service.js";
import { SimulateurNotification } from "../notifications/simulateur-notification.js";
import type { FournisseurNotification } from "../notifications/fournisseur.js";

export interface AffecterPieceParams {
  idDossierSav: number;
  idProduit: number;
  quantite: number;
  userId: number;
}

// 5.10 : affectation d'une pièce de rechange au dossier, avec décrément du stock (5.2)
export function affecterPieceSav(db: Db, params: AffecterPieceParams) {
  const dossier = db.select().from(schema.savDossier).where(eq(schema.savDossier.idDossierSav, params.idDossierSav)).get();
  if (!dossier) throw new Error(`Dossier SAV ${params.idDossierSav} introuvable`);

  db.insert(schema.savPieceUtilisee)
    .values({ idDossierSav: params.idDossierSav, idProduit: params.idProduit, quantite: params.quantite })
    .run();

  enregistrerMouvement(db, {
    idProduit: params.idProduit,
    siteId: dossier.siteId,
    typeMouvement: "VENTE",
    quantite: params.quantite,
    motif: `SAV dossier ${params.idDossierSav}`,
    utilisateurId: params.userId,
  });
}

export interface ChangerStatutSavParams {
  idDossierSav: number;
  nouveauStatut: StatutSav;
  userId: number;
  diagnostic?: string;
  motif?: string; // obligatoire pour IRREPARABLE / ABANDONNE
  montantMainOeuvre?: number; // saisi au passage en PRET
  montantEncaisse?: number; // saisi au passage en LIVRE si la facture n'est pas déjà validée
}

export interface ChangerStatutSavResultat {
  idDossierSav: number;
  statut: StatutSav;
  idFacture: number | null;
  montantFacture: number | null;
  statutFacture: "BROUILLON" | "VALIDEE" | null;
}

const MOTIFS_OBLIGATOIRES: StatutSav[] = ["IRREPARABLE", "ABANDONNE"];

// 5.10, 8.4 : cycle de vie du dossier SAV. La facturation est générée
// automatiquement au passage en PRET (brouillon, garantie = gratuit et
// auto-validée) et encaissée au passage en LIVRE. Le client est notifié
// (SMS/e-mail, 8.4) au passage en PRET, s'il est rattaché à un abonné.
export function changerStatutSav(
  db: Db,
  params: ChangerStatutSavParams,
  fournisseurNotification: FournisseurNotification = new SimulateurNotification()
): ChangerStatutSavResultat {
  const dossier = db.select().from(schema.savDossier).where(eq(schema.savDossier.idDossierSav, params.idDossierSav)).get();
  if (!dossier) throw new Error(`Dossier SAV ${params.idDossierSav} introuvable`);

  if (!peutTransitionnerSav(dossier.statut, params.nouveauStatut)) {
    throw new Error(`Transition invalide : ${dossier.statut} -> ${params.nouveauStatut}`);
  }
  if (MOTIFS_OBLIGATOIRES.includes(params.nouveauStatut) && !params.motif) {
    throw new Error(`Un motif est obligatoire pour passer un dossier en ${params.nouveauStatut}`);
  }

  let idFacture = dossier.idFacture;
  let montantFacture: number | null = null;
  let statutFacture: "BROUILLON" | "VALIDEE" | null = null;

  if (params.nouveauStatut === "PRET") {
    const montantMainOeuvre = params.montantMainOeuvre ?? 0;
    const pieces = db.select().from(schema.savPieceUtilisee).where(eq(schema.savPieceUtilisee.idDossierSav, dossier.idDossierSav)).all();

    let montantPieces = 0;
    for (const piece of pieces) {
      const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, piece.idProduit)).get();
      montantPieces += (produit?.prixVente ?? 0) * piece.quantite;
    }

    montantFacture = dossier.sousGarantie === 1 ? 0 : montantPieces + montantMainOeuvre;

    const facture = db
      .insert(schema.facture)
      .values({ siteId: dossier.siteId, idAbonne: dossier.idAbonne, creePar: params.userId, montantTotal: montantFacture })
      .returning()
      .get();
    idFacture = facture.idFacture;

    for (const piece of pieces) {
      const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, piece.idProduit)).get();
      db.insert(schema.ligneVente)
        .values({ idFacture: facture.idFacture, idProduit: piece.idProduit, quantite: piece.quantite, prixApplique: produit?.prixVente ?? 0 })
        .run();
    }
    if (montantMainOeuvre > 0) {
      db.insert(schema.ligneVente).values({ idFacture: facture.idFacture, prixApplique: montantMainOeuvre }).run();
    }

    if (montantFacture === 0) {
      db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();
      statutFacture = "VALIDEE";
    } else {
      statutFacture = "BROUILLON";
    }

    db.update(schema.savDossier)
      .set({ montantMainOeuvre })
      .where(eq(schema.savDossier.idDossierSav, dossier.idDossierSav))
      .run();

    // 8.4 : notification au client lorsque l'appareil passe au statut « Prêt »
    // — uniquement possible pour un dossier rattaché à un abonné (nullable, client non-abonné)
    if (dossier.idAbonne !== null) {
      envoyerNotificationAbonne(db, fournisseurNotification, {
        idAbonne: dossier.idAbonne,
        evenement: "SAV_PRET",
        message: "Votre appareil est prêt à être récupéré.",
        idDossierSav: dossier.idDossierSav,
      });
    }
  }

  if (params.nouveauStatut === "LIVRE") {
    const facture = idFacture ? db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get() : undefined;
    if (facture && facture.statut === "BROUILLON") {
      if (!params.montantEncaisse || params.montantEncaisse <= 0) {
        throw new Error("Un encaissement est requis pour restituer l'appareil (6.4)");
      }
      db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: params.montantEncaisse }).run();
      db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();
    }
    statutFacture = "VALIDEE";
    montantFacture = facture?.montantTotal ?? montantFacture;
  }

  db.update(schema.savDossier)
    .set({ statut: params.nouveauStatut, diagnostic: params.diagnostic ?? dossier.diagnostic, idFacture })
    .where(eq(schema.savDossier.idDossierSav, dossier.idDossierSav))
    .run();

  db.insert(schema.savHistorique)
    .values({
      idDossierSav: dossier.idDossierSav,
      statutAvant: dossier.statut,
      statutApres: params.nouveauStatut,
      motif: params.motif,
      utilisateurId: params.userId,
    })
    .run();

  return { idDossierSav: dossier.idDossierSav, statut: params.nouveauStatut, idFacture, montantFacture, statutFacture };
}
