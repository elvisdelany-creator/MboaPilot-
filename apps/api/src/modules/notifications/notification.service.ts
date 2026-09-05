import { desc, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import type { CanalNotification, FournisseurNotification } from "./fournisseur.js";

export interface EnvoyerNotificationParams {
  idAbonne: number;
  evenement: "ALERTE_ECHEANCE" | "SAV_PRET";
  message: string;
  idAlerte?: number;
  idDossierSav?: number;
}

// 4.4 : J-7 courtoisie optionnelle, J-3/J-1 systématique — dans tous les cas
// conditionné à l'existence d'un canal de contact (téléphone et/ou e-mail) ;
// 8.4 : notification client au passage d'un dossier SAV en « Prêt ».
// Journalise chaque envoi (8.3), y compris un échec fournisseur — jamais
// d'exception pour un problème d'acheminement, qui ne doit pas faire
// échouer le job quotidien ou le changement de statut SAV qui la déclenche.
export function envoyerNotificationAbonne(db: Db, fournisseur: FournisseurNotification, params: EnvoyerNotificationParams) {
  const abonne = db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, params.idAbonne)).get();
  if (!abonne) throw new Error(`Abonné ${params.idAbonne} introuvable`);

  const canaux: { canal: CanalNotification; destinataire: string }[] = [];
  if (abonne.telephone) canaux.push({ canal: "SMS", destinataire: abonne.telephone });
  if (abonne.email) canaux.push({ canal: "EMAIL", destinataire: abonne.email });

  return canaux.map(({ canal, destinataire }) => {
    const { reussi } = fournisseur.envoyer(canal, { destinataire, message: params.message });
    return db
      .insert(schema.notification)
      .values({
        idAbonne: params.idAbonne,
        canal,
        evenement: params.evenement,
        destinataire,
        message: params.message,
        statutEnvoi: reussi ? "ENVOYEE" : "ECHOUEE",
        idAlerte: params.idAlerte,
        idDossierSav: params.idDossierSav,
      })
      .returning()
      .get();
  });
}

// 8.3 : journal des notifications d'un abonné, consultable (statut d'envoi par canal)
export function listerNotificationsAbonne(db: Db, idAbonne: number) {
  return db
    .select()
    .from(schema.notification)
    .where(eq(schema.notification.idAbonne, idAbonne))
    .orderBy(desc(schema.notification.idNotification))
    .all();
}
