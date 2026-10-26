import { eq, gt, max } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export type TypeOperationAbonnement = "REABONNEMENT" | "CHANGEMENT_FORMULE" | "ECHANGE_MATERIEL";

// ce qu'une opération sur abonnement existant peut changer d'un abonnement
export interface EtatAbonnement {
  idFormule: number;
  dateDebut: string;
  dateFin: string;
  statut: "ACTIF" | "EXPIRE" | "RESILIE";
  idComptePartage: number | null;
}

export interface MaterielOperation {
  idNouveau: number;
  idsRemplaces: number[];
  idProduit: number;
  siteId: number;
}

export interface DetailsOperationEnAttente {
  avant: EtatAbonnement;
  apres: EtatAbonnement;
  idsHistorique: number[];
  materiel?: MaterielOperation;
}

export function etatAbonnement(db: Db, numeroAbonnement: number): EtatAbonnement {
  const a = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get();
  if (!a) throw new Error(`Abonnement ${numeroAbonnement} introuvable`);
  return { idFormule: a.idFormule, dateDebut: a.dateDebut, dateFin: a.dateFin, statut: a.statut, idComptePartage: a.idComptePartage };
}

// repère pris avant l'opération : les lignes d'historique qu'elle crée sont celles dont l'identifiant le dépasse
export function dernierIdHistorique(db: Db): number {
  return db.select({ dernier: max(schema.historiqueAbonnement.idHisto) }).from(schema.historiqueAbonnement).get()?.dernier ?? 0;
}

export interface EnregistrerOperationEnAttenteParams {
  idFacture: number;
  numeroAbonnement: number;
  type: TypeOperationAbonnement;
  avant: EtatAbonnement;
  idHistoriqueAvant: number;
  materiel?: MaterielOperation;
}

// À appeler une fois l'opération faite, seulement si sa facture reste BROUILLON : de quoi la défaire si le paiement n'aboutit jamais.
export function enregistrerOperationEnAttente(db: Db, params: EnregistrerOperationEnAttenteParams): void {
  const idsHistorique = db
    .select({ id: schema.historiqueAbonnement.idHisto })
    .from(schema.historiqueAbonnement)
    .where(gt(schema.historiqueAbonnement.idHisto, params.idHistoriqueAvant))
    .all()
    .map((h) => h.id);
  const details: DetailsOperationEnAttente = {
    avant: params.avant,
    apres: etatAbonnement(db, params.numeroAbonnement),
    idsHistorique,
    materiel: params.materiel,
  };
  db.insert(schema.operationAbonnementEnAttente)
    .values({ idFacture: params.idFacture, numeroAbonnement: params.numeroAbonnement, type: params.type, details: JSON.stringify(details) })
    .run();
}
