import { eq } from "drizzle-orm";
import { calculerDateFin, calculerPrixKit } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { creerAbonne, type AbonneInput } from "../abonnes/abonne.repository.js";
import { construireKitCalcul } from "../catalogue/kit-mapper.js";

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
  montantCommissionCanalplus?: number; // taux vendeur/apporteur — fourni par le paramétrage (8.8)
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
  const idAbonne =
    "idAbonne" in params.abonne
      ? params.abonne.idAbonne
      : creerAbonne(db, { siteId: params.siteId, ...params.abonne }).idAbonne;

  const formule = db.select().from(schema.formule).where(eq(schema.formule.idFormule, params.idFormule)).get();
  if (!formule) throw new Error(`Formule ${params.idFormule} introuvable`);

  const famille = db
    .select()
    .from(schema.familleAbonnement)
    .where(eq(schema.familleAbonnement.idFamille, formule.idFamille))
    .get();

  const dateDebut = params.dateDebut ?? params.aujourdHui;
  const dateFin = calculerDateFin(dateDebut, formule.dureeCycles, formule.modeDuree);

  const abonnement = db
    .insert(schema.abonnement)
    .values({
      idAbonne,
      idFormule: formule.idFormule,
      siteId: params.siteId,
      dateDebut,
      dateFin,
      apporteurId: params.apporteurId,
      creePar: params.userId,
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
      db.insert(schema.suiviCommissionCanalplus)
        .values({
          numeroAbonnement: abonnement.numeroAbonnement,
          vendeurId: params.userId,
          apporteurId: params.apporteurId,
          montantCommission: params.montantCommissionCanalplus ?? 0,
          dateFinProbatoire,
        })
        .run();
    }
  }

  return { numeroAbonnement: abonnement.numeroAbonnement, idFacture: facture.idFacture, statutFacture };
}
