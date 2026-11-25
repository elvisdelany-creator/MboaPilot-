import { and, eq, gte, lt, lte } from "drizzle-orm";
import { classerUrgenceEcheance, decalerJour, evaluerExpiration, evaluerSuiviCommission, joursAvantEcheance, messageRelanceEcheance, texteContactMessage } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { sansAttendreLeDisque } from "../../db/sans-attendre-le-disque.js";
import { trouverDureeConservationDonneesEntreprise, trouverJalonsAlerteEntreprise } from "../entreprise/entreprise.repository.js";
import { listerAbonnesEligiblesAnonymisationAutomatique } from "../abonnes/abonne.repository.js";
import { anonymiserAbonne } from "../abonnes/anonymisation.service.js";
import { envoyerNotificationAbonne } from "../notifications/notification.service.js";
import { SimulateurNotification } from "../notifications/simulateur-notification.js";
import type { FournisseurNotification } from "../notifications/fournisseur.js";
import { calculerEtatLicence } from "../licence/licence.service.js";

// 8.3 : le message est lu par le client — "2026-09-23" devient "23/09/2026"
function formaterDateFrancaise(dateIso: string): string {
  const [annee, mois, jour] = dateIso.split("-");
  return `${jour}/${mois}/${annee}`;
}

// « CANAL+ EVASION » : l'opérateur et la formule de l'abonnement, tels que le client les connaît
function libelleAbonnement(db: Db, idFormule: number): string {
  const formule = db.select().from(schema.formule).where(eq(schema.formule.idFormule, idFormule)).get();
  if (!formule) return "";
  const famille = db.select().from(schema.familleAbonnement).where(eq(schema.familleAbonnement.idFamille, formule.idFamille)).get();
  return [famille?.libelle, formule.libelle].filter(Boolean).join(" ");
}

// lecture seule : la licence n'est pas créée ici (elle l'est au premier accès de l'application)
function licenceDegradee(db: Db, aujourdHui: string): boolean {
  const licence = db.select().from(schema.licence).get();
  return licence !== undefined && calculerEtatLicence(licence, `${aujourdHui}T12:00:00.000Z`).etat === "DEGRADE";
}

// Une date avancée par erreur (horloge du poste) expirait des abonnements encore valables, et corriger l'heure ne les rétablissait pas. Un
// abonnement expiré par la tâche elle-même alors que sa date de fin n'est pas passée ne peut venir que de là : il redevient actif, avec sa trace.
// Les suivis de commission faussés à cette occasion reprennent leur cours.
function retablirApresErreurHorloge(db: Db, aujourdHui: string): number {
  const suspects = db
    .select()
    .from(schema.abonnement)
    .where(and(eq(schema.abonnement.statut, "EXPIRE"), gte(schema.abonnement.dateFin, aujourdHui)))
    .all();

  return db.transaction(() => {
    let retablis = 0;
    for (const { numeroAbonnement } of suspects) {
      const changements = db
        .select()
        .from(schema.historiqueAbonnement)
        .where(and(eq(schema.historiqueAbonnement.numeroAbonnement, numeroAbonnement), eq(schema.historiqueAbonnement.typeChangement, "STATUT")))
        .orderBy(schema.historiqueAbonnement.idHisto)
        .all();
      const dernier = changements.at(-1);
      if (dernier?.valeurApres !== "EXPIRE" || dernier.motif !== "expiration_automatique") continue;

      db.update(schema.abonnement).set({ statut: "ACTIF" }).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).run();
      db.insert(schema.historiqueAbonnement)
        .values({ numeroAbonnement, typeChangement: "STATUT", valeurAvant: "EXPIRE", valeurApres: "ACTIF", motif: "correction_horloge", utilisateurId: null })
        .run();
      // la commission annulée par cette fausse expiration reprend son suivi ; après une première expiration plus ancienne, qui a pu l'annuler
      // à bon droit, elle est laissée telle quelle
      if (changements.filter((c) => c.motif === "expiration_automatique").length === 1) {
        db.update(schema.suiviCommissionCanalplus)
          .set({ statut: "EN_COURS" })
          .where(and(eq(schema.suiviCommissionCanalplus.numeroAbonnement, numeroAbonnement), eq(schema.suiviCommissionCanalplus.statut, "ANNULEE")))
          .run();
      }
      retablis += 1;
    }
    // une commission ne s'acquiert qu'après sa période probatoire : confirmée avant, elle l'a été avec une fausse date
    db.update(schema.suiviCommissionCanalplus)
      .set({ statut: "EN_COURS" })
      .where(and(eq(schema.suiviCommissionCanalplus.statut, "CONFIRMEE"), gte(schema.suiviCommissionCanalplus.dateFinProbatoire, aujourdHui)))
      .run();
    return retablis;
  });
}

export interface JobQuotidienResultat {
  abonnementsRetablis: number;
  abonnementsExpires: number;
  alertesCreees: number;
  notificationsTentees: number;
  commissionsConfirmees: number;
  commissionsAnnulees: number;
  abonnesAnonymises: number;
}

// 4.3, 4.4, 6.2 : job quotidien — fait transitionner les abonnements expirés,
// journalise les alertes J-7/J-3/J-1 et notifie le client par SMS/e-mail si un
// canal de contact existe (4.4, 8.3), évalue le suivi de commission CANAL+.
// Exécuté sans utilisateur humain : les traces d'historique portent
// utilisateur_id = NULL pour distinguer une action système d'une action manuelle.
export function executerJobQuotidien(
  db: Db,
  aujourdHui: string,
  fournisseurNotification: FournisseurNotification = new SimulateurNotification()
): JobQuotidienResultat {
  // chaque étape est reprise au job suivant si elle manque : inutile de figer la caisse à attendre le disque pour chaque rappel
  return sansAttendreLeDisque(db, () => traiterJournee(db, aujourdHui, fournisseurNotification));
}

function traiterJournee(db: Db, aujourdHui: string, fournisseurNotification: FournisseurNotification): JobQuotidienResultat {
  const resultat: JobQuotidienResultat = {
    abonnementsRetablis: retablirApresErreurHorloge(db, aujourdHui),
    abonnementsExpires: 0,
    alertesCreees: 0,
    notificationsTentees: 0,
    commissionsConfirmees: 0,
    commissionsAnnulees: 0,
    abonnesAnonymises: 0,
  };

  // 8.8 : jalons paramétrables — mode local mono-entreprise (2.2), un seul
  // jeu de seuils pour tous les sites traités par ce job
  const jalonsConfigures = trouverJalonsAlerteEntreprise(db);

  // Le job tourne d'un seul bloc dans le serveur de la caisse : seuls les abonnements concernés sont lus (sur 40 000 abonnements actifs, une
  // poignée est à expirer ou à relancer un jour donné), et les expirations s'écrivent en un seul lot. Écrites une à une, 3 260 expirations
  // après une longue interruption gelaient la caisse 4 à 5 secondes ; en un lot, une seconde. Le lot est atomique : une panne d'écriture au
  // milieu n'en laisse aucune à moitié faite, et le job suivant les reprend toutes.
  const aExpirer = db
    .select()
    .from(schema.abonnement)
    .where(and(eq(schema.abonnement.statut, "ACTIF"), lt(schema.abonnement.dateFin, aujourdHui)))
    .orderBy(schema.abonnement.numeroAbonnement)
    .all();
  db.transaction(() => {
    for (const abonnement of aExpirer) {
      const nouveauStatut = evaluerExpiration(abonnement.statut, abonnement.dateFin, aujourdHui);
      if (nouveauStatut === abonnement.statut) continue;
      db.update(schema.abonnement)
        .set({ statut: nouveauStatut })
        .where(eq(schema.abonnement.numeroAbonnement, abonnement.numeroAbonnement))
        .run();
      db.insert(schema.historiqueAbonnement)
        .values({
          numeroAbonnement: abonnement.numeroAbonnement,
          typeChangement: "STATUT",
          valeurAvant: abonnement.statut,
          valeurApres: nouveauStatut,
          motif: "expiration_automatique",
          utilisateurId: null,
        })
        .run();
      resultat.abonnementsExpires += 1;
    }
  });

  // abonnements à relancer : encore actifs (fin incluse) et à moins de « jalon le plus anticipé » jours de leur fin. Un abonnement qui vient
  // d'expirer n'est plus éligible à une alerte de rappel : sa date de fin est passée, il n'est pas dans cette fenêtre.
  const fenetreJours = Math.max(jalonsConfigures.urgent, jalonsConfigures.modere, jalonsConfigures.anticipe);
  const aRelancer = db
    .select()
    .from(schema.abonnement)
    .where(and(eq(schema.abonnement.statut, "ACTIF"), gte(schema.abonnement.dateFin, aujourdHui), lte(schema.abonnement.dateFin, decalerJour(aujourdHui, fenetreJours))))
    .orderBy(schema.abonnement.numeroAbonnement)
    .all();

  for (const abonnement of aRelancer) {
    // 4.4 : palier atteint (le plus urgent dont le seuil est franchi), et non plus « exactement le jour du seuil » :
    // si le poste était éteint le jour exact (dimanche, coupure), l'alerte est rattrapée au premier job suivant.
    const joursRestants = joursAvantEcheance(abonnement.dateFin, aujourdHui);
    const jalon = joursRestants >= 0 ? classerUrgenceEcheance(joursRestants, jalonsConfigures) : null;
    if (jalon) {
      // une seule alerte par palier ET par cycle : une alerte de ce palier déjà créée dans la fenêtre qui précède la
      // date de fin courante ; celles d'un cycle précédent (avant un réabonnement) sont plus anciennes et ne comptent pas
      const debutFenetre = decalerJour(abonnement.dateFin, -jalonsConfigures.anticipe);
      const dejaEnvoyee = db
        .select()
        .from(schema.alerteEcheance)
        .where(eq(schema.alerteEcheance.numeroAbonnement, abonnement.numeroAbonnement))
        .all()
        // une alerte datée du futur (horloge avancée par erreur) ne dispense pas du vrai rappel
        .some((a) => a.jalonJours === jalon.jours && a.dateDeclenchement >= debutFenetre && a.dateDeclenchement <= aujourdHui);
      if (!dejaEnvoyee) {
        // l'alerte et son message s'écrivent ensemble : une alerte restée seule après une coupure passait pour « client prévenu », et le
        // rappel n'était plus jamais envoyé. Interrompue, l'opération est refaite entière au job suivant.
        const notifications = db.transaction(() => {
          const alerte = db
            .insert(schema.alerteEcheance)
            .values({ numeroAbonnement: abonnement.numeroAbonnement, jalonJours: jalon.jours, dateDeclenchement: aujourdHui })
            .returning()
            .get();

          // 4.4 : J-7 courtoisie optionnelle, J-3/J-1 systématique — dans tous
          // les cas conditionné à l'existence d'un canal de contact (géré par
          // envoyerNotificationAbonne, qui n'envoie que sur les coordonnées renseignées)
          return envoyerNotificationAbonne(db, fournisseurNotification, {
            idAbonne: abonnement.idAbonne,
            evenement: "ALERTE_ECHEANCE",
            message: messageRelanceEcheance({
              entreprise: db.select().from(schema.entreprise).get()?.nom ?? "",
              libelleAbonnement: libelleAbonnement(db, abonnement.idFormule),
              numeroAbonnement: abonnement.numeroAbonnement,
              dateFin: formaterDateFrancaise(abonnement.dateFin),
              joursRestants,
              rang: jalon.rang,
              // le client peut répondre : numéros de la boutique de l'abonnement (vide si non renseignés)
              contact: texteContactMessage(db.select().from(schema.site).where(eq(schema.site.idSite, abonnement.siteId)).get() ?? {}),
            }),
            idAlerte: alerte.idAlerte,
          });
        });
        resultat.alertesCreees += 1;
        resultat.notificationsTentees += notifications.length;
      }
    }
  }

  const suivisEnCours = db
    .select()
    .from(schema.suiviCommissionCanalplus)
    .where(eq(schema.suiviCommissionCanalplus.statut, "EN_COURS"))
    .all();

  for (const suivi of suivisEnCours) {
    const abonnementCourant = db
      .select()
      .from(schema.abonnement)
      .where(eq(schema.abonnement.numeroAbonnement, suivi.numeroAbonnement))
      .get();
    if (!abonnementCourant) continue;

    const nouveauStatutSuivi = evaluerSuiviCommission(
      suivi.statut,
      abonnementCourant.statut,
      suivi.dateFinProbatoire,
      aujourdHui,
      abonnementCourant.dateFin
    );
    if (nouveauStatutSuivi !== suivi.statut) {
      db.update(schema.suiviCommissionCanalplus)
        .set({ statut: nouveauStatutSuivi })
        .where(eq(schema.suiviCommissionCanalplus.idSuivi, suivi.idSuivi))
        .run();
      if (nouveauStatutSuivi === "CONFIRMEE") resultat.commissionsConfirmees += 1;
      if (nouveauStatutSuivi === "ANNULEE") resultat.commissionsAnnulees += 1;
    }
  }

  // 11.3 : "durée de conservation définie et paramétrable, avec archivage ou
  // anonymisation au-delà" — mono-entreprise (2.2), pas de filtre par site
  // 10.3, 10.4 : le mode dégradé ne supprime jamais de données — l'anonymisation, irréversible, attend
  // la réactivation (les abonnés restent éligibles et sont traités au premier job qui suit).
  if (!licenceDegradee(db, aujourdHui)) {
    const dureeConservation = trouverDureeConservationDonneesEntreprise(db);
    const eligibles = listerAbonnesEligiblesAnonymisationAutomatique(db, aujourdHui, dureeConservation);
    for (const { abonne } of eligibles) {
      anonymiserAbonne(db, { idAbonne: abonne.idAbonne });
      resultat.abonnesAnonymises += 1;
    }
  }

  return resultat;
}
