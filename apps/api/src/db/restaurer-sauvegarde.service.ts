import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

// 2.6 : restaure une sauvegarde dans le fichier de base. Lève une erreur (message en français) sans toucher
// à rien si le fichier est introuvable ou n'est pas une base saine.
export function restaurerSauvegarde(cheminSauvegarde: string, cheminBase: string): void {
  if (!existsSync(cheminSauvegarde)) throw new Error(`Fichier de sauvegarde introuvable : ${cheminSauvegarde}`);

  // vérifie que le fichier est une base SQLite exploitable avant d'écraser quoi que ce soit
  let integrity: string;
  try {
    const verification = new Database(cheminSauvegarde, { readonly: true });
    try {
      integrity = (verification.pragma("integrity_check(1)", { simple: false }) as { integrity_check: string }[])[0].integrity_check;
    } finally {
      verification.close();
    }
  } catch {
    throw new Error(`Le fichier ${cheminSauvegarde} n'est pas une base MboaPilot lisible — restauration annulée.`);
  }
  if (integrity !== "ok") throw new Error(`Sauvegarde corrompue (integrity_check: ${integrity}) — restauration annulée.`);

  mkdirSync(dirname(cheminBase), { recursive: true });

  // Après un arrêt brutal, les dernières écritures de l'ancienne base vivent dans son journal -wal : mises de côté à part, elles
  // laissaient « mboapilot.db.avant-restauration » vide ou périmé, et annuler la restauration comme l'explique le guide
  // (remettre ce seul fichier sous le nom mboapilot.db) perdait des données. On fusionne donc le journal d'abord. Base
  // illisible : on ne force rien, ses trois fichiers sont conservés tels quels ci-dessous.
  if (existsSync(cheminBase)) {
    try {
      const ancienne = new Database(cheminBase);
      try {
        ancienne.pragma("wal_checkpoint(TRUNCATE)");
      } finally {
        ancienne.close();
      }
    } catch {
      // conservée telle quelle
    }
  }

  // écarte l'ancienne base plutôt que de la supprimer directement (filet de sécurité manuel). Un filet
  // laissé par une restauration précédente n'est jamais écrasé : il est daté et gardé à côté, sinon une
  // 2e restauration (mauvaise sauvegarde choisie d'abord) détruirait les données d'avant la 1re.
  const horodatage = new Date().toISOString().replace(/[:.]/g, "-");
  for (const suffixe of ["", "-wal", "-shm"]) {
    const filet = `${cheminBase}${suffixe}.avant-restauration`;
    if (existsSync(filet)) renameSync(filet, `${filet}.${horodatage}`);
    if (existsSync(`${cheminBase}${suffixe}`)) renameSync(`${cheminBase}${suffixe}`, filet);
  }

  copyFileSync(cheminSauvegarde, cheminBase);
}
