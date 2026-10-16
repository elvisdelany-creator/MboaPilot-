import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { typeImageDetecte } from "../../lib/images.js";

// 5.10 : extensions dérivées du type MIME (jamais du nom de fichier fourni
// par le client) — même logique de liste blanche que la validation serveur
// habituelle (11.2, jamais de confiance aveugle dans l'entrée utilisateur).
const EXTENSIONS_PAR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const LONGUEUR_MAX_NOM_ORIGINAL = 100;

// nom d'origine fourni par le client : borné, en conservant l'extension à la fin
function nomOriginalBorne(nom: string): string {
  const propre = nom.trim();
  if (propre.length <= LONGUEUR_MAX_NOM_ORIGINAL) return propre;
  const extension = propre.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "";
  return propre.slice(0, LONGUEUR_MAX_NOM_ORIGINAL - extension.length) + extension;
}

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
  // le type et l'extension viennent du CONTENU (signature du fichier), jamais du type MIME
  // déclaré par le client : un HTML ou un exécutable annoncé « image/jpeg » est refusé
  const typeDetecte = typeImageDetecte(input.contenu);
  if (!typeDetecte) throw new Error("Le fichier n'est pas une image valide (PNG, JPEG, GIF ou WebP attendu)");
  const extension = EXTENSIONS_PAR_MIME[typeDetecte];

  if (!existsSync(dossierPhotos)) mkdirSync(dossierPhotos, { recursive: true });

  const nomFichier = `${randomUUID()}.${extension}`;
  writeFileSync(join(dossierPhotos, nomFichier), input.contenu);

  return db
    .insert(schema.savPhoto)
    .values({
      idDossierSav: input.idDossierSav,
      nomFichier,
      nomFichierOriginal: nomOriginalBorne(input.nomFichierOriginal),
      typeMime: typeDetecte,
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
