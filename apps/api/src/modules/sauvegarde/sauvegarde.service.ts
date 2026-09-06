import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../../db/types.js";

const PREFIXE_FICHIER = "mboapilot-sauvegarde-";
const EXTENSION = ".db";
const REGEX_NOM_FICHIER = /^mboapilot-sauvegarde-(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/;

export interface Sauvegarde {
  nomFichier: string;
  dateCreation: string; // ISO — date logique de la sauvegarde (horodatage du nom de fichier)
  tailleOctets: number;
}

// horodatage triable lexicographiquement (ISO sans ':'/'.') : la suppression
// "la plus ancienne d'abord" peut trier les noms sans lire chaque fichier.
// La date logique est ré-extraite du nom (voir extraireDateDuNom) plutôt que
// lue depuis la date de modification du fichier, pour rester déterministe
// même si le fichier est copié/déplacé après coup (mtime non fiable).
function construireNomFichier(maintenant: Date): string {
  const horodatage = maintenant.toISOString().replace(/[:.]/g, "-");
  return `${PREFIXE_FICHIER}${horodatage}${EXTENSION}`;
}

function extraireDateDuNom(nomFichier: string): string | null {
  const correspondance = nomFichier.match(REGEX_NOM_FICHIER);
  if (!correspondance) return null;
  const [, prefixeDateHeure, minutes, secondes, millisecondes] = correspondance;
  return `${prefixeDateHeure}:${minutes}:${secondes}.${millisecondes}Z`;
}

// 2.6, 💡 Conseil d'architecte : VACUUM INTO produit une copie cohérente et
// compacte du fichier SQLite même à chaud (base ouverte, WAL), sans bloquer
// les écritures en cours — contrairement à une copie physique brute du fichier.
export function creerSauvegarde(db: Db, dossierSauvegardes: string, maintenant = new Date()): Sauvegarde {
  mkdirSync(dossierSauvegardes, { recursive: true });
  const nomFichier = construireNomFichier(maintenant);
  const chemin = join(dossierSauvegardes, nomFichier);
  db.$client.prepare("VACUUM INTO ?").run(chemin);
  return { nomFichier, dateCreation: maintenant.toISOString(), tailleOctets: statSync(chemin).size };
}

// 2.6 : sauvegardes existantes, la plus récente en premier
export function listerSauvegardes(dossierSauvegardes: string): Sauvegarde[] {
  if (!existsSync(dossierSauvegardes)) return [];
  return readdirSync(dossierSauvegardes)
    .filter((nomFichier) => nomFichier.startsWith(PREFIXE_FICHIER) && nomFichier.endsWith(EXTENSION))
    .map((nomFichier) => {
      const stat = statSync(join(dossierSauvegardes, nomFichier));
      return { nomFichier, dateCreation: extraireDateDuNom(nomFichier) ?? stat.mtime.toISOString(), tailleOctets: stat.size };
    })
    .sort((a, b) => b.nomFichier.localeCompare(a.nomFichier));
}

// 2.6 : conservation glissante — supprime les sauvegardes plus vieilles que le délai configuré
export function nettoyerAnciennesSauvegardes(dossierSauvegardes: string, joursConservation: number, maintenant = new Date()): string[] {
  const seuil = new Date(maintenant.getTime() - joursConservation * 24 * 60 * 60 * 1000);
  const supprimees: string[] = [];
  for (const sauvegarde of listerSauvegardes(dossierSauvegardes)) {
    if (new Date(sauvegarde.dateCreation) < seuil) {
      unlinkSync(join(dossierSauvegardes, sauvegarde.nomFichier));
      supprimees.push(sauvegarde.nomFichier);
    }
  }
  return supprimees;
}
