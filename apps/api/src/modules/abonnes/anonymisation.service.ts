import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverAbonne } from "./abonne.repository.js";

export interface AnonymiserAbonneParams {
  idAbonne: number;
  // 11.3 : absent = anonymisation automatique déclenchée par le job
  // quotidien (durée de conservation expirée), comme historique_abonnement
  // (utilisateur_id NULL = job automatique, 4.3)
  userId?: number;
}

const PLACEHOLDER_NOM = "Anonymisé";
// 11.3, 4.4 : téléphone non-NULL au niveau schéma — ce repère doit rester
// reconnaissable comme "aucun canal de contact réel" par notification.service.ts,
// sans quoi le job quotidien continuerait de "joindre" un client anonymisé
export const PLACEHOLDER_TELEPHONE = "0000000000";

// 11.3 : droit de suppression — efface l'identité et les coordonnées d'un
// abonné (nom, prénom, téléphone, email, CNI, adresse) tout en conservant sa
// fiche et son historique transactionnel (factures, abonnements), sous
// réserve des obligations comptables/légales de conservation (11.3).
// Irréversible, journalisé comme la fusion de doublons (8.1). Utilisée à la
// fois manuellement (interface d'administration) et automatiquement par le
// job quotidien une fois la durée de conservation paramétrée dépassée.
// ⚠️ Outil technique uniquement : la conformité précise (durée de
// conservation, base légale du traitement) doit être validée par un conseil
// juridique local avant tout usage réel — voir l'avertissement du cahier des charges (11.3).
export function anonymiserAbonne(db: Db, params: AnonymiserAbonneParams) {
  const abonne = trouverAbonne(db, params.idAbonne);
  if (!abonne) throw new Error(`Abonné ${params.idAbonne} introuvable`);

  // 11.3, 11.5 : le journal d'audit trace QUE l'identité a été effacée,
  // jamais l'identité elle-même — contrairement à la fusion de doublons
  // (fusion-abonnes.service.ts), qui journalise la fiche complète du
  // doublon supprimé à des fins de traçabilité d'un dédoublonnage, pas d'un
  // droit à l'oubli. Journaliser ici les valeurs effacées viderait le droit
  // de suppression de son sens : la fiche personnelle survivrait en clair,
  // indéfiniment, dans une autre table consultable par l'encadrement (11.5).
  db.insert(schema.journalAudit)
    .values({
      utilisateurId: params.userId,
      action: "SUPPRESSION",
      tableCible: "abonne",
      idCible: String(params.idAbonne),
      valeurAvant: JSON.stringify({ champsEffaces: ["nom", "prenom", "telephone", "email", "numeroCni", "adresse"] }),
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
