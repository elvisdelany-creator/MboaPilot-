import type { Db } from "./types.js";

// Réservé aux traitements entièrement rejouables, faits de nombreuses petites écritures : chaque transaction reste tout ou rien, mais on
// n'attend pas le disque à chaque fois (synchronous = NORMAL). Une coupure de courant peut en effacer les dernières, qui sont alors refaites au
// passage suivant. Jamais pour un geste de caisse : voir ouvrir-base.ts. Le traitement doit être synchrone, pour qu'aucune autre écriture ne
// s'intercale pendant que le réglage est assoupli.
export function sansAttendreLeDisque<T>(db: Db, traitement: () => T): T {
  // SQLite interdit de changer ce réglage au milieu d'une transaction
  if (db.$client.inTransaction) return traitement();
  const habituel = db.$client.pragma("synchronous", { simple: true }) as number;
  db.$client.pragma("synchronous = NORMAL");
  try {
    return traitement();
  } finally {
    db.$client.pragma(`synchronous = ${habituel}`);
  }
}
