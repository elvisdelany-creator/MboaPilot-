import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../../db/types.js";
import { forcerSurDisque } from "../../lib/disque.js";

const PREFIXE_FICHIER = "mboapilot-sauvegarde-";
const EXTENSION = ".db";
// nom porté pendant la copie : il ne finit pas par « .db », donc ni la liste ni la restauration ne le prennent pour une sauvegarde
const SUFFIXE_PARTIEL = ".partiel";
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
// La copie ne prend son nom définitif qu'une fois complète et sur le disque : un serveur arrêté en cours de route ne laisse jamais un
// fichier tronqué qui passerait pour la sauvegarde du jour.
export function creerSauvegarde(db: Db, dossierSauvegardes: string, maintenant = new Date()): Sauvegarde {
  mkdirSync(dossierSauvegardes, { recursive: true });
  effacerCopiesInterrompues(dossierSauvegardes);
  const nomFichier = construireNomFichier(maintenant);
  const chemin = join(dossierSauvegardes, nomFichier);
  const partiel = `${chemin}${SUFFIXE_PARTIEL}`;
  try {
    db.$client.prepare("VACUUM INTO ?").run(partiel);
    forcerSurDisque(partiel);
    renameSync(partiel, chemin);
  } catch (erreur) {
    effacerCopiesInterrompues(dossierSauvegardes);
    throw erreur;
  }
  return { nomFichier, dateCreation: maintenant.toISOString(), tailleOctets: statSync(chemin).size };
}

// restes d'une copie interrompue (avec leur journal SQLite) : inutilisables, et aussi gros qu'une sauvegarde
function effacerCopiesInterrompues(dossierSauvegardes: string): void {
  for (const nom of readdirSync(dossierSauvegardes)) {
    if (!nom.startsWith(PREFIXE_FICHIER) || !nom.includes(`${EXTENSION}${SUFFIXE_PARTIEL}`)) continue;
    try {
      rmSync(join(dossierSauvegardes, nom), { force: true });
    } catch {
      // fichier retenu par un autre programme (antivirus) : il sera effacé la prochaine fois, sans empêcher la sauvegarde
    }
  }
}

// 2.6 : sauvegarde de fin de journée, déclenchée par la clôture de caisse. La sauvegarde quotidienne a lieu au démarrage du serveur puis
// est bloquée pour la journée : elle ne contient jamais les ventes du jour (et le jour de l'installation, c'est celle d'une base vide).
// La clôture est la fin de journée naturelle ; seule une sauvegarde de moins de deux minutes (clôture rejouée, double clic, export manuel juste avant) n'est pas
// refaite. Le seuil n'est PAS d'une heure : après une coupure de courant, le serveur redémarre et fait une sauvegarde de démarrage, qui ne contient pas les ventes
// faites ensuite ; un seuil d'une heure ferait ignorer la clôture du soir et laisserait la journée hors de toute sauvegarde.
// La conservation de 30 jours s'applique à ces sauvegardes comme aux autres.
const AGE_MIN_SAUVEGARDE_FIN_JOURNEE_MS = 2 * 60 * 1000;

export function sauvegarderApresCloture(db: Db, dossierSauvegardes: string, maintenant = new Date(), joursConservation = 30): Sauvegarde | null {
  const derniere = listerSauvegardes(dossierSauvegardes)[0];
  if (derniere && maintenant.getTime() - new Date(derniere.dateCreation).getTime() < AGE_MIN_SAUVEGARDE_FIN_JOURNEE_MS) return null;
  const sauvegarde = creerSauvegarde(db, dossierSauvegardes, maintenant);
  nettoyerAnciennesSauvegardes(dossierSauvegardes, joursConservation, maintenant);
  return sauvegarde;
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
