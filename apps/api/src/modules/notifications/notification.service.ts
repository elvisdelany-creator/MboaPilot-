import { desc, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import type { CanalNotification, FournisseurNotification } from "./fournisseur.js";
import { PLACEHOLDER_TELEPHONE } from "../abonnes/anonymisation.service.js";

// Une passerelle réelle peut lever une exception (réseau coupé, délai dépassé) : elle remontait au job
// quotidien après l'enregistrement de l'alerte du jour, et le SMS n'était jamais renvoyé. Un problème
// d'acheminement est donc journalisé comme un échec d'envoi, jamais propagé.
function envoyerSansException(fournisseur: FournisseurNotification, canal: CanalNotification, params: { destinataire: string; message: string }): boolean {
  try {
    return fournisseur.envoyer(canal, params).reussi;
  } catch (erreur) {
    console.error(`[API] échec d'acheminement de la notification (${canal})`, erreur);
    return false;
  }
}

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
  // 11.3 : le repère laissé par une anonymisation n'est pas un vrai canal
  if (abonne.telephone && abonne.telephone !== PLACEHOLDER_TELEPHONE) canaux.push({ canal: "SMS", destinataire: abonne.telephone });
  if (abonne.email) canaux.push({ canal: "EMAIL", destinataire: abonne.email });

  return canaux.map(({ canal, destinataire }) => {
    const reussi = envoyerSansException(fournisseur, canal, { destinataire, message: params.message });
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

export interface EnvoyerNotificationClientPonctuelParams {
  telephone: string;
  evenement: "SAV_PRET";
  message: string;
  idDossierSav: number;
}

// 5.10, 8.4 : "Notification au client lorsque l'appareil passe au statut «
// Prêt »" s'applique aussi à un client ponctuel non-abonné (sav_dossier),
// via le seul canal disponible pour lui (SMS, pas de fiche e-mail) —
// idAbonne reste NULL, contrairement à envoyerNotificationAbonne ci-dessus.
export function envoyerNotificationClientPonctuel(db: Db, fournisseur: FournisseurNotification, params: EnvoyerNotificationClientPonctuelParams) {
  const reussi = envoyerSansException(fournisseur, "SMS", { destinataire: params.telephone, message: params.message });
  return db
    .insert(schema.notification)
    .values({
      idAbonne: null,
      canal: "SMS",
      evenement: params.evenement,
      destinataire: params.telephone,
      message: params.message,
      statutEnvoi: reussi ? "ENVOYEE" : "ECHOUEE",
      idDossierSav: params.idDossierSav,
    })
    .returning()
    .get();
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
