import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { texteFacultatif } from "../../lib/champs-texte.js";
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

// Ce que l'apporteur lui-même consulte : il est un partenaire EXTERNE. Il voit ses clients (nom, téléphone), ses commissions et ses règlements, pas
// leur n° de CNI, leur adresse ni leur e-mail, ni les identifiants internes du personnel de la boutique. C'est exactement ce que montre son écran.
export interface FicheApporteurRestreinte {
  apporteur: FicheApporteur["apporteur"];
  abonnes: { idAbonne: number; prenom: string; nom: string; telephone: string }[];
  chiffreAffaires: number;
  commissionsCanalplus: { idSuivi: number; numeroAbonnement: number; montantCommission: number; dateFinProbatoire: string; statut: string }[];
  reglements: { idReglement: number; montant: number; modePaiement: string; reference: string | null; dateReglement: string }[];
  montantCommissionConfirmee: number;
  montantCommissionRegle: number;
  soldeCommissionDu: number;
}

export function ficheVisibleParApporteur(fiche: FicheApporteur): FicheApporteurRestreinte {
  return {
    apporteur: fiche.apporteur,
    abonnes: fiche.abonnes.map((a) => ({ idAbonne: a.idAbonne, prenom: a.prenom, nom: a.nom, telephone: a.telephone })),
    chiffreAffaires: fiche.chiffreAffaires,
    commissionsCanalplus: fiche.commissionsCanalplus.map((c) => ({
      idSuivi: c.idSuivi,
      numeroAbonnement: c.numeroAbonnement,
      montantCommission: c.montantCommission,
      dateFinProbatoire: c.dateFinProbatoire,
      statut: c.statut,
    })),
    reglements: fiche.reglements.map((r) => ({ idReglement: r.idReglement, montant: r.montant, modePaiement: r.modePaiement, reference: r.reference, dateReglement: r.dateReglement })),
    montantCommissionConfirmee: fiche.montantCommissionConfirmee,
    montantCommissionRegle: fiche.montantCommissionRegle,
    soldeCommissionDu: fiche.soldeCommissionDu,
  };
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
//
// 2.5.2, 11.3 : un apporteur est commun à l'entreprise, mais le gérant d'une boutique ne doit pas voir les clients (nom,
// téléphone) ni le chiffre d'affaires des autres boutiques. Avec `siteId`, la fiche se limite à cette boutique : ses clients,
// son chiffre d'affaires et ses commissions. Les montants globaux dus à l'apporteur (règlements, solde) restent alors masqués :
// ils mêlent toutes les boutiques et relèvent de l'administrateur. Sans `siteId` (administrateur, apporteur lui-même) : vue complète.
export function construireFicheApporteur(db: Db, idApporteur: number, siteId?: number): FicheApporteur {
  const apporteur = trouverApporteur(db, idApporteur);
  if (!apporteur) throw new Error(`Apporteur ${idApporteur} introuvable`);

  const abonnes = db
    .select()
    .from(schema.abonne)
    .where(siteId === undefined ? eq(schema.abonne.apporteurId, idApporteur) : and(eq(schema.abonne.apporteurId, idApporteur), eq(schema.abonne.siteId, siteId)))
    .all();
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

  let commissionsCanalplus = db
    .select()
    .from(schema.suiviCommissionCanalplus)
    .where(eq(schema.suiviCommissionCanalplus.apporteurId, idApporteur))
    .all();

  if (siteId === undefined) {
    return { apporteur, abonnes, chiffreAffaires, commissionsCanalplus, ...calculerSoldeCommission(db, idApporteur) };
  }

  const abonnementsDuSite = new Set(db.select({ numero: schema.abonnement.numeroAbonnement }).from(schema.abonnement).where(eq(schema.abonnement.siteId, siteId)).all().map((a) => a.numero));
  commissionsCanalplus = commissionsCanalplus.filter((c) => abonnementsDuSite.has(c.numeroAbonnement));
  const montantCommissionConfirmee = commissionsCanalplus.filter((c) => c.statut === "CONFIRMEE").reduce((total, c) => total + c.montantCommission, 0);
  return { apporteur, abonnes, chiffreAffaires, commissionsCanalplus, reglements: [], montantCommissionConfirmee, montantCommissionRegle: 0, soldeCommissionDu: 0 };
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
export function listerResumesApporteurs(db: Db, siteId?: number): ResumeApporteur[] {
  return listerApporteurs(db)
    .filter((a) => a.actif === 1)
    .map((a) => {
      const fiche = construireFicheApporteur(db, a.idApporteur, siteId);
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

const MODES_PAIEMENT: readonly string[] = ["CASH", "CHEQUE", "VIREMENT", "MOBILE_MONEY"];

// 6.3 : enregistre un règlement de commission — jamais au-delà du solde
// CONFIRMEE restant dû (garde-fou métier, comme un avoir ne peut excéder sa facture d'origine)
export function enregistrerReglement(db: Db, params: EnregistrerReglementCommissionInput) {
  const apporteur = trouverApporteur(db, params.apporteurId);
  if (!apporteur) throw new Error(`Apporteur ${params.apporteurId} introuvable`);

  if (!Number.isInteger(params.montant) || params.montant <= 0) {
    throw new Error("Le montant du règlement doit être un entier positif en FCFA");
  }
  if (!MODES_PAIEMENT.includes(params.modePaiement)) throw new Error("Mode de paiement du règlement invalide");
  // référence (n° de virement, de chèque…) : nettoyée, 100 caractères maximum, vide = non renseignée
  const reference = texteFacultatif(params.reference, "La référence du règlement", 100) ?? undefined;

  const { soldeCommissionDu } = calculerSoldeCommission(db, params.apporteurId);
  if (params.montant > soldeCommissionDu) {
    throw new Error(`Le règlement (${params.montant}) dépasse le solde de commissions dû (${soldeCommissionDu})`);
  }

  return enregistrerReglementCommission(db, { ...params, reference });
}
