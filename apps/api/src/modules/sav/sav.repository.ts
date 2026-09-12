import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

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
  const dossier = db
    .insert(schema.savDossier)
    .values({
      siteId: input.siteId,
      idAbonne: input.idAbonne,
      clientNom: input.clientNom,
      clientTelephone: input.clientTelephone,
      descriptionPanne: input.descriptionPanne,
      etatReception: input.etatReception,
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

export function listerPiecesUtilisees(db: Db, idDossierSav: number) {
  return db.select().from(schema.savPieceUtilisee).where(eq(schema.savPieceUtilisee.idDossierSav, idDossierSav)).all();
}

export function listerHistoriqueSav(db: Db, idDossierSav: number) {
  return db.select().from(schema.savHistorique).where(eq(schema.savHistorique.idDossierSav, idDossierSav)).all();
}

// pour afficher le montant à encaisser avant de restituer l'appareil (PRET -> LIVRE)
export function trouverFactureSav(db: Db, idFacture: number) {
  return db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
}
