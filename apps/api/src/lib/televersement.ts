import "@fastify/multipart";
import { readFileSync } from "node:fs";
import type { FastifyRequest } from "fastify";

// 11.2 : lecture d'un fichier téléversé (multipart) avec plafond de taille.
// @fastify/multipart tronque le flux au-delà de la limite et ne lève pas toujours
// l'exception de dépassement (selon le rythme d'arrivée des données) : un fichier trop
// gros était alors accepté et enregistré tronqué. Le drapeau « tronqué » est donc vérifié
// explicitement, en plus de l'exception.
export class FichierTropGrosError extends Error {
  constructor(public readonly tailleMaxOctets: number) {
    super("Le fichier dépasse la taille maximale autorisée");
  }
}

export interface FichierTeleverse {
  contenu: Buffer;
  nomFichierOriginal: string;
  typeMime: string;
}

export async function lireFichierTeleverse(request: FastifyRequest, tailleMaxOctets: number): Promise<FichierTeleverse> {
  const fichier = await request.file({ limits: { fileSize: tailleMaxOctets } });
  if (!fichier) throw new Error("Aucun fichier fourni");

  let contenu: Buffer;
  try {
    contenu = await fichier.toBuffer();
  } catch (erreur) {
    if ((erreur as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw new FichierTropGrosError(tailleMaxOctets);
    throw erreur;
  }
  if (fichier.file.truncated) throw new FichierTropGrosError(tailleMaxOctets);

  return { contenu, nomFichierOriginal: fichier.filename, typeMime: fichier.mimetype };
}

// Lecture d'un fichier déjà enregistré (logo, photo SAV). Après une restauration sur un autre poste, la base
// peut référencer un fichier absent du disque (docs/exploitation.md §3) : `null` plutôt qu'une erreur 500.
export function lireFichierStocke(chemin: string): Buffer | null {
  try {
    return readFileSync(chemin);
  } catch (erreur) {
    if ((erreur as { code?: string }).code === "ENOENT") return null;
    throw erreur;
  }
}
