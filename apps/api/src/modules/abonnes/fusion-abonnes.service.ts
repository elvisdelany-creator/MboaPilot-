import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverAbonne } from "./abonne.repository.js";

export interface FusionnerAbonnesParams {
  idAbonnePrincipal: number;
  idAbonneDoublon: number;
  userId: number;
}

// 8.1 : fusion de doublons — rattache tout l'historique (abonnements,
// factures, dossiers SAV, notifications) du doublon à la fiche principale,
// journalise l'opération dans le journal d'audit immuable (11.5), puis
// supprime le doublon devenu orphelin. Opération destructrice : la
// confirmation est portée par l'appelant (route/UI), jamais silencieuse.
// Tout est exécuté dans une transaction : un échec (ex. contrainte de clé
// étrangère sur une table liée non prévue ici) ne doit jamais laisser une
// fusion à moitié faite ni une entrée d'audit mensongère.
export function fusionnerAbonnes(db: Db, params: FusionnerAbonnesParams) {
  if (params.idAbonnePrincipal === params.idAbonneDoublon) {
    throw new Error("Impossible de fusionner un abonné avec lui-même");
  }

  const principal = trouverAbonne(db, params.idAbonnePrincipal);
  if (!principal) throw new Error(`Abonné ${params.idAbonnePrincipal} introuvable`);
  const doublon = trouverAbonne(db, params.idAbonneDoublon);
  if (!doublon) throw new Error(`Abonné ${params.idAbonneDoublon} introuvable`);

  if (principal.siteId !== doublon.siteId) {
    throw new Error("Les deux fiches doivent appartenir au même site pour être fusionnées");
  }

  db.transaction((tx) => {
    tx.update(schema.abonnement).set({ idAbonne: params.idAbonnePrincipal }).where(eq(schema.abonnement.idAbonne, params.idAbonneDoublon)).run();
    tx.update(schema.facture).set({ idAbonne: params.idAbonnePrincipal }).where(eq(schema.facture.idAbonne, params.idAbonneDoublon)).run();
    tx.update(schema.savDossier).set({ idAbonne: params.idAbonnePrincipal }).where(eq(schema.savDossier.idAbonne, params.idAbonneDoublon)).run();
    tx.update(schema.notification).set({ idAbonne: params.idAbonnePrincipal }).where(eq(schema.notification.idAbonne, params.idAbonneDoublon)).run();

    tx.insert(schema.journalAudit)
      .values({
        utilisateurId: params.userId,
        action: "SUPPRESSION",
        tableCible: "abonne",
        idCible: String(params.idAbonneDoublon),
        valeurAvant: JSON.stringify(doublon),
      })
      .run();

    tx.delete(schema.abonne).where(eq(schema.abonne.idAbonne, params.idAbonneDoublon)).run();
  });

  return { idAbonnePrincipal: params.idAbonnePrincipal, idAbonneDoublon: params.idAbonneDoublon };
}
