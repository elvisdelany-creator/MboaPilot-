import { eq } from "drizzle-orm";
import { calculerDateFin, calculerPrixKit, peutAffecterEcran } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { creerAbonne, type AbonneInput } from "../abonnes/abonne.repository.js";
import { construireKitCalcul } from "../catalogue/kit-mapper.js";
import { compterEcransOccupes, trouverComptePartage } from "../comptes-partages/compte-partage.repository.js";
import { trouverApporteur } from "../apporteurs/apporteur.repository.js";
import { trouverTauxCommissionVendeurParSite } from "../entreprise/entreprise.repository.js";

export interface RecruterAbonneParams {
  siteId: number;
  userId: number;
  aujourdHui: string; // horloge injectée pour testabilité (4.2 : date du jour par défaut)
  abonne: { idAbonne: number } | Omit<AbonneInput, "siteId">;
  idFormule: number;
  idKit?: number;
  dateDebut?: string;
  montantEncaisse: number;
  apporteurId?: number;
  idComptePartage?: number; // 5.9 : écran/profil affecté sur un compte streaming mutualisé
}

export interface RecrutementResultat {
  numeroAbonnement: number;
  idFacture: number;
  statutFacture: "BROUILLON" | "VALIDEE";
}

const DUREE_PROBATION_CANALPLUS_CYCLES = 4; // 4 mois = 119 jours (6.2)
const LIBELLE_FAMILLE_CANALPLUS = "CANAL+";

// 7.1 : création d'un nouvel abonnement, pour un abonné nouveau ou existant
export function recruterAbonne(db: Db, params: RecruterAbonneParams): RecrutementResultat {
  // 6.3 : le lien apporteur↔abonné n'est renseigné qu'à la création de l'abonné,
  // jamais modifié ensuite par un recrutement — seul un abonné existant transmet
  // son lien permanent (hérité) au recrutement en cours si aucun n'est précisé.
  let apporteurIdEffectif = params.apporteurId;

  const idAbonne =
    "idAbonne" in params.abonne
      ? params.abonne.idAbonne
      : creerAbonne(db, { siteId: params.siteId, ...params.abonne, apporteurId: params.apporteurId }).idAbonne;

  if ("idAbonne" in params.abonne && apporteurIdEffectif === undefined) {
    const abonneExistant = db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, idAbonne)).get();
    apporteurIdEffectif = abonneExistant?.apporteurId ?? undefined;
  }

  const formule = db.select().from(schema.formule).where(eq(schema.formule.idFormule, params.idFormule)).get();
  if (!formule) throw new Error(`Formule ${params.idFormule} introuvable`);

  const famille = db
    .select()
    .from(schema.familleAbonnement)
    .where(eq(schema.familleAbonnement.idFamille, formule.idFamille))
    .get();

  const dateDebut = params.dateDebut ?? params.aujourdHui;
  const dateFin = calculerDateFin(dateDebut, formule.dureeCycles, formule.modeDuree);

  // 5.9 : alerte de capacité — un compte partagé streaming ne peut pas
  // accueillir plus d'écrans simultanés que sa limite fournisseur
  if (params.idComptePartage !== undefined) {
    const comptePartage = trouverComptePartage(db, params.idComptePartage);
    if (!comptePartage) throw new Error(`Compte partagé ${params.idComptePartage} introuvable`);
    const ecransOccupes = compterEcransOccupes(db, params.idComptePartage);
    if (!peutAffecterEcran(comptePartage.nombreEcransMax, ecransOccupes)) {
      throw new Error(`Capacité atteinte : ${comptePartage.libelle} n'a plus d'écran disponible (${ecransOccupes}/${comptePartage.nombreEcransMax})`);
    }
  }

  const abonnement = db
    .insert(schema.abonnement)
    .values({
      idAbonne,
      idFormule: formule.idFormule,
      siteId: params.siteId,
      dateDebut,
      dateFin,
      apporteurId: apporteurIdEffectif,
      creePar: params.userId,
      idComptePartage: params.idComptePartage,
    })
    .returning()
    .get();

  let kitRow: typeof schema.kit.$inferSelect | undefined;
  let prixKit = 0;
  if (params.idKit !== undefined) {
    kitRow = db.select().from(schema.kit).where(eq(schema.kit.idKit, params.idKit)).get();
    if (!kitRow) throw new Error(`Kit ${params.idKit} introuvable`);
    prixKit = calculerPrixKit(construireKitCalcul(db, kitRow), { idFormule: formule.idFormule, prix: formule.prix });
  }

  const montantTotal = formule.prix + prixKit;

  const facture = db
    .insert(schema.facture)
    .values({ siteId: params.siteId, idAbonne, creePar: params.userId, montantTotal })
    .returning()
    .get();

  db.insert(schema.ligneVente)
    .values({ idFacture: facture.idFacture, numeroAbonnement: abonnement.numeroAbonnement, prixApplique: formule.prix })
    .run();

  if (kitRow) {
    db.insert(schema.ligneVente).values({ idFacture: facture.idFacture, idKit: kitRow.idKit, prixApplique: prixKit }).run();
  }

  let statutFacture: "BROUILLON" | "VALIDEE" = "BROUILLON";

  // 6.4 : dès qu'un encaissement (même partiel) est enregistré, la facture devient VALIDEE
  if (params.montantEncaisse > 0) {
    db.insert(schema.paiement).values({ idFacture: facture.idFacture, mode: "CASH", montant: params.montantEncaisse }).run();
    db.update(schema.facture).set({ statut: "VALIDEE" }).where(eq(schema.facture.idFacture, facture.idFacture)).run();
    statutFacture = "VALIDEE";

    // 6.2 : uniquement sur un recrutement CANAL+ validé (encaissé), jamais un réabonnement
    if (famille?.libelle === LIBELLE_FAMILLE_CANALPLUS) {
      const dateFinProbatoire = calculerDateFin(dateDebut, DUREE_PROBATION_CANALPLUS_CYCLES, "STRICT_30J");
      // 6.2, 8.8 : montant_commission = calculer_commission(...) — taux de
      // l'apporteur référent s'il est renseigné (et configuré), sinon taux
      // vendeur par défaut de l'entreprise ; 0 si rien n'est paramétré
      const tauxPourMille =
        (apporteurIdEffectif !== undefined ? trouverApporteur(db, apporteurIdEffectif)?.tauxCommissionDefaut : undefined) ??
        trouverTauxCommissionVendeurParSite(db, params.siteId) ??
        0;
      const montantCommission = Math.round((montantTotal * tauxPourMille) / 1000);
      db.insert(schema.suiviCommissionCanalplus)
        .values({
          numeroAbonnement: abonnement.numeroAbonnement,
          vendeurId: params.userId,
          apporteurId: apporteurIdEffectif,
          montantCommission,
          dateFinProbatoire,
        })
        .run();
    }
  }

  return { numeroAbonnement: abonnement.numeroAbonnement, idFacture: facture.idFacture, statutFacture };
}
