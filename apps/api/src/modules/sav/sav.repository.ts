import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { telephoneFacultatif, texteFacultatif, texteObligatoire } from "../../lib/champs-texte.js";
import { verifierBooleen } from "../../lib/validation.js";

export interface OuvrirDossierInput {
  siteId: number;
  idAbonne?: number;
  // 5.10, 8.4 : identité du client ponctuel (non-abonné) — libre, pour la
  // restitution et la notification au passage en PRET (voir sav.service.ts)
  clientNom?: string;
  clientTelephone?: string;
  descriptionPanne: string;
  etatReception?: string;
  sousGarantie: boolean;
  userId: number;
}

// 5.10, 8.4 : ouverture de dossier, avec ou sans rattachement à un abonné
export function creerDossierSav(db: Db, input: OuvrirDossierInput) {
  const descriptionPanne = texteObligatoire(input.descriptionPanne, "La panne annoncée", 500);
  // un texte non vide ("non") est « vrai » : le dossier passerait sous garantie, donc facture gratuite
  verifierBooleen(input.sousGarantie, "Le champ sous garantie");

  const dossier = db
    .insert(schema.savDossier)
    .values({
      siteId: input.siteId,
      idAbonne: input.idAbonne,
      clientNom: texteFacultatif(input.clientNom, "Le nom du client", 100) ?? undefined,
      clientTelephone: telephoneFacultatif(input.clientTelephone, "Le téléphone du client") ?? undefined,
      descriptionPanne,
      etatReception: texteFacultatif(input.etatReception, "L'état à la réception", 500) ?? undefined,
      sousGarantie: input.sousGarantie ? 1 : 0,
    })
    .returning()
    .get();

  db.insert(schema.savHistorique)
    .values({ idDossierSav: dossier.idDossierSav, statutAvant: null, statutApres: "RECU", utilisateurId: input.userId })
    .run();

  return dossier;
}

export function trouverDossierSav(db: Db, idDossierSav: number) {
  return db.select().from(schema.savDossier).where(eq(schema.savDossier.idDossierSav, idDossierSav)).get();
}

export function listerDossiersSav(db: Db, siteId: number) {
  return db.select().from(schema.savDossier).where(eq(schema.savDossier.siteId, siteId)).all();
}

// 5.10 : enrichie du libellé du produit, affiché tel quel dans "Pièces affectées"
export function listerPiecesUtilisees(db: Db, idDossierSav: number) {
  return db
    .select({
      idPieceUtilisee: schema.savPieceUtilisee.idPieceUtilisee,
      idDossierSav: schema.savPieceUtilisee.idDossierSav,
      idProduit: schema.savPieceUtilisee.idProduit,
      quantite: schema.savPieceUtilisee.quantite,
      libelleProduit: schema.produit.libelle,
    })
    .from(schema.savPieceUtilisee)
    .leftJoin(schema.produit, eq(schema.savPieceUtilisee.idProduit, schema.produit.idProduit))
    .where(eq(schema.savPieceUtilisee.idDossierSav, idDossierSav))
    .all();
}

export function listerHistoriqueSav(db: Db, idDossierSav: number) {
  return db.select().from(schema.savHistorique).where(eq(schema.savHistorique.idDossierSav, idDossierSav)).all();
}

// pour afficher le montant à encaisser avant de restituer l'appareil (PRET -> LIVRE)
export function trouverFactureSav(db: Db, idFacture: number) {
  return db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
}
