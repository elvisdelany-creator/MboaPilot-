import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import type { CanalNotification, FournisseurNotification, ResultatEnvoi } from "./fournisseur.js";
import { PLACEHOLDER_TELEPHONE } from "../abonnes/anonymisation.service.js";

// Une passerelle réelle peut lever une exception (réseau coupé, délai dépassé) : elle remontait au job
// quotidien après l'enregistrement de l'alerte du jour, et le SMS n'était jamais renvoyé. Un problème
// d'acheminement est donc journalisé comme un échec d'envoi, jamais propagé.
function envoyerSansException(fournisseur: FournisseurNotification, canal: CanalNotification, params: { destinataire: string; message: string }): ResultatEnvoi {
  try {
    return fournisseur.envoyer(canal, params);
  } catch (erreur) {
    console.error(`[API] échec d'acheminement de la notification (${canal})`, erreur);
    return { reussi: false };
  }
}

// un simulateur n'envoie rien : le journal ne doit jamais prétendre le contraire
function statutDepuisResultat(resultat: ResultatEnvoi): "ENVOYEE" | "SIMULEE" | "ECHOUEE" {
  if (!resultat.reussi) return "ECHOUEE";
  return resultat.simule ? "SIMULEE" : "ENVOYEE";
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
    const resultat = envoyerSansException(fournisseur, canal, { destinataire, message: params.message });
    return db
      .insert(schema.notification)
      .values({
        idAbonne: params.idAbonne,
        canal,
        evenement: params.evenement,
        destinataire,
        message: params.message,
        statutEnvoi: statutDepuisResultat(resultat),
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
  const resultat = envoyerSansException(fournisseur, "SMS", { destinataire: params.telephone, message: params.message });
  return db
    .insert(schema.notification)
    .values({
      idAbonne: null,
      canal: "SMS",
      evenement: params.evenement,
      destinataire: params.telephone,
      message: params.message,
      statutEnvoi: statutDepuisResultat(resultat),
      idDossierSav: params.idDossierSav,
    })
    .returning()
    .get();
}

// 8.3 : journal des notifications d'un abonné, consultable (statut d'envoi par canal). `auteur` : la personne de la boutique qui a ouvert une relance
// WhatsApp (null pour les SMS et e-mails automatiques).
export function listerNotificationsAbonne(db: Db, idAbonne: number) {
  return db
    .select({ notification: schema.notification, prenom: schema.utilisateur.prenom, nom: schema.utilisateur.nom })
    .from(schema.notification)
    .leftJoin(schema.utilisateur, eq(schema.notification.utilisateurId, schema.utilisateur.idUser))
    .where(eq(schema.notification.idAbonne, idAbonne))
    .orderBy(desc(schema.notification.idNotification))
    .all()
    .map(({ notification, prenom, nom }) => ({ ...notification, auteur: prenom !== null && nom !== null ? `${prenom} ${nom}` : null }));
}

// --- Relances WhatsApp : le clic sur « Relancer sur WhatsApp » (tableau de bord) est noté dans le journal du client ---
// L'application ouvre WhatsApp avec le message prêt ; c'est la personne de la boutique qui l'envoie. Le journal dit donc « ouverte », jamais
// « envoyée » : rien ne permet de confirmer l'envoi.
const EVENEMENTS_RELANCE_WHATSAPP = ["ALERTE_ECHEANCE", "ABONNEMENT_EXPIRE"] as const;
const LONGUEUR_MAX_MESSAGE_RELANCE = 1000;

export interface EnregistrerRelanceWhatsAppParams {
  idAbonne: number;
  evenement: (typeof EVENEMENTS_RELANCE_WHATSAPP)[number];
  message: string;
  numeroAbonnement?: number;
  userId: number;
}

export function enregistrerRelanceWhatsApp(db: Db, params: EnregistrerRelanceWhatsAppParams) {
  const abonne = db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, params.idAbonne)).get();
  if (!abonne) throw new Error(`Abonné ${params.idAbonne} introuvable`);
  // 11.3 : un abonné anonymisé n'a plus de numéro à qui écrire
  if (!abonne.telephone || abonne.telephone === PLACEHOLDER_TELEPHONE) throw new Error("Cet abonné est anonymisé : il n'y a plus de numéro à qui écrire");
  if (!EVENEMENTS_RELANCE_WHATSAPP.includes(params.evenement)) throw new Error("Événement de relance inconnu");
  if (typeof params.message !== "string" || params.message.trim() === "") throw new Error("Le message de la relance est obligatoire");
  if (params.message.length > LONGUEUR_MAX_MESSAGE_RELANCE) throw new Error(`Le message de la relance ne peut pas dépasser ${LONGUEUR_MAX_MESSAGE_RELANCE} caractères`);
  if (params.numeroAbonnement !== undefined) {
    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, params.numeroAbonnement)).get();
    if (!abonnement || abonnement.idAbonne !== params.idAbonne) throw new Error(`Abonnement ${params.numeroAbonnement} introuvable pour ce client`);
  }

  return db
    .insert(schema.notification)
    .values({
      idAbonne: params.idAbonne,
      canal: "WHATSAPP",
      evenement: params.evenement,
      destinataire: abonne.telephone,
      message: params.message.trim(),
      statutEnvoi: "OUVERTE",
      numeroAbonnement: params.numeroAbonnement,
      utilisateurId: params.userId,
    })
    .returning()
    .get();
}

// date de la dernière relance WhatsApp de chaque abonnement donné (absent de la table : jamais relancé) — « déjà relancé » du tableau de bord
export function dernieresRelancesWhatsApp(db: Db, numerosAbonnement: number[]): Map<number, string> {
  if (numerosAbonnement.length === 0) return new Map();
  const lignes = db
    .select({ numero: schema.notification.numeroAbonnement, derniere: max(schema.notification.dateEnvoi) })
    .from(schema.notification)
    .where(and(eq(schema.notification.canal, "WHATSAPP"), inArray(schema.notification.numeroAbonnement, numerosAbonnement)))
    .groupBy(schema.notification.numeroAbonnement)
    .all();
  return new Map(lignes.filter((l): l is { numero: number; derniere: string } => l.numero !== null && l.derniere !== null).map((l) => [l.numero, l.derniere]));
}
