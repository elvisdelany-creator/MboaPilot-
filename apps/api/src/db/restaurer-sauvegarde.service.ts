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
  const effectues: [de: string, vers: string][] = [];
  const renommer = (de: string, vers: string) => {
    renameSync(de, vers);
    effectues.push([de, vers]);
  };
  try {
    for (const suffixe of ["", "-wal", "-shm"]) {
      const filet = `${cheminBase}${suffixe}.avant-restauration`;
      if (existsSync(filet)) renommer(filet, `${filet}.${horodatage}`);
      if (existsSync(`${cheminBase}${suffixe}`)) renommer(`${cheminBase}${suffixe}`, filet);
    }
    copyFileSync(cheminSauvegarde, cheminBase);
  } catch (erreur) {
    // Windows refuse de renommer une base que le serveur garde ouverte (EBUSY/EPERM) : on remet tout en place pour ne jamais
    // laisser une base à moitié déplacée, puis on dit quoi faire au lieu de relayer le message brut du système.
    for (const [de, vers] of effectues.reverse()) {
      try {
        renameSync(vers, de);
      } catch {
        // meilleur effort : les fichiers restent sous leur nouveau nom, présents à côté
      }
    }
    const code = (erreur as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      throw new Error("La base est utilisée par le serveur MboaPilot : arrêtez le serveur (fermez la fenêtre du lanceur), puis relancez la restauration. Rien n'a été modifié.");
    }
    throw erreur;
  }
}
