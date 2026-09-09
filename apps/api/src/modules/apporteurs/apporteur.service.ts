import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import {
  enregistrerReglementCommission,
  listerApporteurs,
  listerReglementsApporteur,
  trouverApporteur,
  type EnregistrerReglementCommissionInput,
} from "./apporteur.repository.js";

export interface FicheApporteur {
  apporteur: typeof schema.sousDistributeur.$inferSelect;
  abonnes: (typeof schema.abonne.$inferSelect)[];
  chiffreAffaires: number;
  commissionsCanalplus: (typeof schema.suiviCommissionCanalplus.$inferSelect)[];
  // 6.3 : "historique de règlement de ses commissions" — montant CONFIRMEE
  // (6.2) définitivement acquis, montant déjà versé, et solde restant dû
  reglements: (typeof schema.reglementCommission.$inferSelect)[];
  montantCommissionConfirmee: number;
  montantCommissionRegle: number;
  soldeCommissionDu: number;
}

function calculerSoldeCommission(db: Db, idApporteur: number) {
  const montantCommissionConfirmee = db
    .select()
    .from(schema.suiviCommissionCanalplus)
    .where(and(eq(schema.suiviCommissionCanalplus.apporteurId, idApporteur), eq(schema.suiviCommissionCanalplus.statut, "CONFIRMEE")))
    .all()
    .reduce((total, s) => total + s.montantCommission, 0);

  const reglements = listerReglementsApporteur(db, idApporteur);
  const montantCommissionRegle = reglements.reduce((total, r) => total + r.montant, 0);

  return { reglements, montantCommissionConfirmee, montantCommissionRegle, soldeCommissionDu: montantCommissionConfirmee - montantCommissionRegle };
}

// 6.3 : fiche apporteur — abonnés référés, CA généré, commissions dues/confirmées/annulées
// (y compris le suivi CANAL+ 4 mois, 6.2), et historique de règlement
export function construireFicheApporteur(db: Db, idApporteur: number): FicheApporteur {
  const apporteur = trouverApporteur(db, idApporteur);
  if (!apporteur) throw new Error(`Apporteur ${idApporteur} introuvable`);

  const abonnes = db.select().from(schema.abonne).where(eq(schema.abonne.apporteurId, idApporteur)).all();
  const idsAbonnes = abonnes.map((a) => a.idAbonne);

  const factures =
    idsAbonnes.length > 0
      ? db
          .select()
          .from(schema.facture)
          .where(inArray(schema.facture.idAbonne, idsAbonnes))
          .all()
          .filter((f) => f.statut === "VALIDEE")
      : [];
  const chiffreAffaires = factures.reduce((total, f) => total + f.montantTotal, 0);

  const commissionsCanalplus = db
    .select()
    .from(schema.suiviCommissionCanalplus)
    .where(eq(schema.suiviCommissionCanalplus.apporteurId, idApporteur))
    .all();

  return { apporteur, abonnes, chiffreAffaires, commissionsCanalplus, ...calculerSoldeCommission(db, idApporteur) };
}

export interface ResumeApporteur {
  idApporteur: number;
  nom: string;
  chiffreAffaires: number;
  montantCommissionConfirmee: number;
  montantCommissionRegle: number;
  soldeCommissionDu: number;
}

// 8.6 : "Suivi des apporteurs d'affaires — Chiffre d'affaires et commissions
// générés par chaque apporteur" — résumé compact pour le tableau de bord,
// réutilise construireFicheApporteur pour ne pas dupliquer le calcul.
// Seuls les apporteurs actifs sont consolidés, triés du CA le plus élevé au plus faible.
export function listerResumesApporteurs(db: Db): ResumeApporteur[] {
  return listerApporteurs(db)
    .filter((a) => a.actif === 1)
    .map((a) => {
      const fiche = construireFicheApporteur(db, a.idApporteur);
      return {
        idApporteur: a.idApporteur,
        nom: a.nom,
        chiffreAffaires: fiche.chiffreAffaires,
        montantCommissionConfirmee: fiche.montantCommissionConfirmee,
        montantCommissionRegle: fiche.montantCommissionRegle,
        soldeCommissionDu: fiche.soldeCommissionDu,
      };
    })
    .sort((a, b) => b.chiffreAffaires - a.chiffreAffaires);
}

// 6.3 : enregistre un règlement de commission — jamais au-delà du solde
// CONFIRMEE restant dû (garde-fou métier, comme un avoir ne peut excéder sa facture d'origine)
export function enregistrerReglement(db: Db, params: EnregistrerReglementCommissionInput) {
  const apporteur = trouverApporteur(db, params.apporteurId);
  if (!apporteur) throw new Error(`Apporteur ${params.apporteurId} introuvable`);

  if (params.montant <= 0) throw new Error("Le montant du règlement doit être positif");

  const { soldeCommissionDu } = calculerSoldeCommission(db, params.apporteurId);
  if (params.montant > soldeCommissionDu) {
    throw new Error(`Le règlement (${params.montant}) dépasse le solde de commissions dû (${soldeCommissionDu})`);
  }

  return enregistrerReglementCommission(db, params);
}
