import { eq } from "drizzle-orm";
import { evaluerExpiration } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { creerAbonne, type AbonneInput } from "../abonnes/abonne.repository.js";
import { exigerComptePartageDisponible } from "../comptes-partages/compte-partage.repository.js";
import { exigerApporteurActif } from "../apporteurs/apporteur.repository.js";

export interface ReprendreAbonneParams {
  siteId: number;
  userId: number;
  aujourdHui: string; // horloge injectée, comme le recrutement (le serveur impose le jour, jamais le poste)
  abonne: { idAbonne: number } | Omit<AbonneInput, "siteId">;
  idFormule: number;
  // la vraie date de fin de l'abonnement en cours chez ce client (YYYY-MM-DD) — c'est tout l'objet de la reprise
  dateFin: string;
  typeMateriel?: string; // DECODEUR par défaut, uniquement avec un numéro de série
  numeroSerie?: string;
  idComptePartage?: number; // 5.9 : écran déjà occupé sur un compte streaming mutualisé
}

export interface RepriseResultat {
  numeroAbonnement: number;
  idAbonne: number; // pour ouvrir la fiche du client juste après la reprise
  statut: "ACTIF" | "EXPIRE";
}

// une date de fin saisie à la main : on borne pour attraper la faute de frappe (2062, 2005) sans empêcher une vraie situation
// (réabonnement anticipé de plusieurs mois ; abonné parti depuis quelques mois qu'on veut reconquérir)
const JOURS_PASSE_MAX = 365;
const JOURS_FUTUR_MAX = 730;
const MS_PAR_JOUR = 86_400_000;

function exigerDateFinPlausible(dateFin: unknown, aujourdHui: string): asserts dateFin is string {
  const correspondance = typeof dateFin === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateFin) : null;
  const instant = correspondance ? Date.UTC(Number(correspondance[1]), Number(correspondance[2]) - 1, Number(correspondance[3])) : NaN;
  // aller-retour : 2026-02-30 est « bien formée » mais n'existe pas (Date la décale au 2 mars)
  if (!correspondance || new Date(instant).toISOString().slice(0, 10) !== dateFin) {
    throw new Error("La date de fin doit être une date valide au format AAAA-MM-JJ");
  }
  const ecartJours = Math.round((instant - Date.parse(`${aujourdHui}T00:00:00Z`)) / MS_PAR_JOUR);
  if (ecartJours > JOURS_FUTUR_MAX) throw new Error(`La date de fin est trop lointaine (plus de ${JOURS_FUTUR_MAX / 365} ans) : vérifiez l'année`);
  if (ecartJours < -JOURS_PASSE_MAX) throw new Error("La date de fin est trop ancienne (plus d'un an) : un abonné parti depuis si longtemps se recrute, il ne se reprend pas");
}

// 4.1, 7.1 : reprise d'un abonné qui existait AVANT l'application. Un recrutement inventerait une vente d'aujourd'hui (chiffre
// d'affaires, commission CANAL+, stock du kit) et ferait repartir l'abonnement d'aujourd'hui au lieu de sa vraie date de fin. La reprise
// enregistre l'état existant — abonné, formule, fin de validité, décodeur — sans facture, paiement ni commission, et le dit dans
// l'historique (auteur, jour, date de fin reprise). Les alertes J-7/J-3/J-1 et le réabonnement fonctionnent ensuite normalement.
export function reprendreAbonneExistant(db: Db, params: ReprendreAbonneParams): RepriseResultat {
  exigerDateFinPlausible(params.dateFin, params.aujourdHui);
  // atomique : l'abonné, l'abonnement, le matériel et l'historique se créent ensemble ou pas du tout
  return db.transaction(() => {
    const formule = db.select().from(schema.formule).where(eq(schema.formule.idFormule, params.idFormule)).get();
    if (!formule) throw new Error(`Formule ${params.idFormule} introuvable`);
    // une formule retirée de la vente (8.8) reste celle d'un abonné qui l'a déjà : seule la VENTE d'une formule est refusée

    if (params.idComptePartage !== undefined) {
      exigerComptePartageDisponible(db, { idComptePartage: params.idComptePartage, siteId: params.siteId, idFamille: formule.idFamille });
    }

    let idAbonne: number;
    if ("idAbonne" in params.abonne) {
      const existant = db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, params.abonne.idAbonne)).get();
      if (!existant) throw new Error(`Abonné ${params.abonne.idAbonne} introuvable`);
      if (existant.siteId !== params.siteId) throw new Error("Cet abonné n'appartient pas à votre site");
      idAbonne = existant.idAbonne;
    } else {
      if (params.abonne.apporteurId !== undefined) exigerApporteurActif(db, params.abonne.apporteurId);
      idAbonne = creerAbonne(db, { siteId: params.siteId, ...params.abonne }).idAbonne;
    }

    // même règle que le job quotidien : l'abonnement n'expire qu'après sa date de fin
    const statut = evaluerExpiration("ACTIF", params.dateFin, params.aujourdHui) as "ACTIF" | "EXPIRE";
    const apporteurId = db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, idAbonne)).get()?.apporteurId ?? undefined;
    const abonnement = db
      .insert(schema.abonnement)
      .values({
        idAbonne,
        idFormule: formule.idFormule,
        siteId: params.siteId,
        // le début réel de la période en cours est inconnu : le jour de la reprise, sans dépasser la fin
        dateDebut: params.aujourdHui < params.dateFin ? params.aujourdHui : params.dateFin,
        dateFin: params.dateFin,
        statut,
        apporteurId,
        creePar: params.userId,
        idComptePartage: params.idComptePartage,
      })
      .returning()
      .get();

    if (params.numeroSerie !== undefined && params.numeroSerie.trim() !== "") {
      db.insert(schema.materielAbonne)
        .values({ numeroAbonnement: abonnement.numeroAbonnement, typeMateriel: params.typeMateriel ?? "DECODEUR", numeroSerie: params.numeroSerie.trim() })
        .run();
    }

    db.insert(schema.historiqueAbonnement)
      .values({
        numeroAbonnement: abonnement.numeroAbonnement,
        typeChangement: "STATUT",
        valeurAvant: null,
        valeurApres: statut,
        motif: `reprise de l'existant : fin de validité au ${params.dateFin}`,
        utilisateurId: params.userId,
      })
      .run();

    return { numeroAbonnement: abonnement.numeroAbonnement, idAbonne, statut };
  });
}
