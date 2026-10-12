import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { typeImageDetecte } from "../../lib/images.js";

// même liste blanche que sav-photo.service.ts — les extensions dérivent
// toujours du type MIME déclaré, jamais du nom de fichier fourni par le client
const EXTENSIONS_PAR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MIME_PAR_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSIONS_PAR_MIME).map(([mime, ext]) => [ext, mime])
);

export interface EnregistrerLogoInput {
  idEntreprise: number;
  contenu: Buffer;
  typeMime: string;
}

// 3.2.1, 13.2 : "personnalisation par entreprise (logo, couleurs, mentions
// légales sur les documents)" — fichier stocké sur disque (mode local),
// même approche que les photos SAV (sav-photo.service.ts). Un seul logo par
// entreprise : chaque envoi écrase le précédent, la base ne portant que son
// nom de fichier (entreprise.logo_url).
export function enregistrerLogoEntreprise(db: Db, dossierLogos: string, input: EnregistrerLogoInput) {
  // le type et l'extension viennent du CONTENU (signature du fichier), jamais du type MIME
  // déclaré par le client : un HTML ou un exécutable annoncé « image/png » est refusé
  const typeDetecte = typeImageDetecte(input.contenu);
  if (!typeDetecte) throw new Error("Le fichier n'est pas une image valide (PNG, JPEG, GIF ou WebP attendu)");
  const extension = EXTENSIONS_PAR_MIME[typeDetecte];

  if (!existsSync(dossierLogos)) mkdirSync(dossierLogos, { recursive: true });

  const ancienLogo = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, input.idEntreprise)).get()?.logoUrl;
  const nomFichier = `entreprise-${input.idEntreprise}.${extension}`;
  writeFileSync(join(dossierLogos, nomFichier), input.contenu);
  // changement de format (png → jpg) : l'ancien fichier ne doit pas rester orphelin sur le disque
  if (ancienLogo && ancienLogo !== nomFichier) {
    try {
      unlinkSync(join(dossierLogos, ancienLogo));
    } catch {
      // déjà absent : sans conséquence
    }
  }

  return db.update(schema.entreprise).set({ logoUrl: nomFichier }).where(eq(schema.entreprise.idEntreprise, input.idEntreprise)).returning().get();
}

export function resoudreTypeMimeLogo(nomFichier: string): string {
  const extension = extname(nomFichier).slice(1);
  return MIME_PAR_EXTENSION[extension] ?? "application/octet-stream";
}
