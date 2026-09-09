import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

// 5.10 : extensions dérivées du type MIME (jamais du nom de fichier fourni
// par le client) — même logique de liste blanche que la validation serveur
// habituelle (11.2, jamais de confiance aveugle dans l'entrée utilisateur).
const EXTENSIONS_PAR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface EnregistrerPhotoInput {
  idDossierSav: number;
  contenu: Buffer;
  nomFichierOriginal: string;
  typeMime: string;
}

// 5.10 : "photos optionnelles" du dossier SAV — fichier stocké sur disque
// (mode local, 2.2) sous un nom généré (non devinable, distinct de l'original),
// la base ne portant que les métadonnées, même approche que les sauvegardes
// exportées (sauvegarde.service.ts).
export function enregistrerPhotoSav(db: Db, dossierPhotos: string, input: EnregistrerPhotoInput): typeof schema.savPhoto.$inferSelect {
  const extension = EXTENSIONS_PAR_MIME[input.typeMime];
  if (!extension) throw new Error(`Type de fichier non autorisé : seules les images sont acceptées (${input.typeMime})`);

  if (!existsSync(dossierPhotos)) mkdirSync(dossierPhotos, { recursive: true });

  const nomFichier = `${randomUUID()}.${extension}`;
  writeFileSync(join(dossierPhotos, nomFichier), input.contenu);

  return db
    .insert(schema.savPhoto)
    .values({
      idDossierSav: input.idDossierSav,
      nomFichier,
      nomFichierOriginal: input.nomFichierOriginal,
      typeMime: input.typeMime,
    })
    .returning()
    .get();
}

export function listerPhotosSav(db: Db, idDossierSav: number) {
  return db.select().from(schema.savPhoto).where(eq(schema.savPhoto.idDossierSav, idDossierSav)).orderBy(asc(schema.savPhoto.idPhoto)).all();
}

export function trouverPhotoSav(db: Db, idPhoto: number) {
  return db.select().from(schema.savPhoto).where(eq(schema.savPhoto.idPhoto, idPhoto)).get();
}
