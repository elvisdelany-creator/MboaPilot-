import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverAbonne } from "./abonne.repository.js";

export interface AnonymiserAbonneParams {
  idAbonne: number;
  userId: number;
}

const PLACEHOLDER_NOM = "Anonymisé";
const PLACEHOLDER_TELEPHONE = "0000000000";

// 11.3 : droit de suppression — efface l'identité et les coordonnées d'un
// abonné (nom, prénom, téléphone, email, CNI, adresse) tout en conservant sa
// fiche et son historique transactionnel (factures, abonnements), sous
// réserve des obligations comptables/légales de conservation (11.3).
// Irréversible, journalisé comme la fusion de doublons (8.1). ⚠️ Outil
// technique uniquement : la conformité précise (durée de conservation, base
// légale du traitement) doit être validée par un conseil juridique local
// avant tout usage réel — voir l'avertissement du cahier des charges (11.3).
export function anonymiserAbonne(db: Db, params: AnonymiserAbonneParams) {
  const abonne = trouverAbonne(db, params.idAbonne);
  if (!abonne) throw new Error(`Abonné ${params.idAbonne} introuvable`);

  db.insert(schema.journalAudit)
    .values({
      utilisateurId: params.userId,
      action: "SUPPRESSION",
      tableCible: "abonne",
      idCible: String(params.idAbonne),
      valeurAvant: JSON.stringify(abonne),
    })
    .run();

  return db
    .update(schema.abonne)
    .set({
      nom: PLACEHOLDER_NOM,
      prenom: PLACEHOLDER_NOM,
      telephone: PLACEHOLDER_TELEPHONE,
      email: null,
      numeroCni: null,
      adresse: null,
    })
    .where(eq(schema.abonne.idAbonne, params.idAbonne))
    .returning()
    .get();
}
