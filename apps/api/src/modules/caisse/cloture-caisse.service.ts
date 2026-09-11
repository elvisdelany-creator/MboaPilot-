import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

const MODES_PAIEMENT = ["CASH", "CHEQUE", "VIREMENT", "MOBILE_MONEY"] as const;
export type ModePaiement = (typeof MODES_PAIEMENT)[number];

export interface OuvrirCaisseParams {
  siteId: number;
  userId: number;
  fondOuverture: number;
}

export interface ComptageInput {
  mode: ModePaiement;
  montantCompte: number;
}

export interface FermerCaisseParams {
  idCloture: number;
  userId: number;
  comptages: ComptageInput[];
}

// 13.1 : "fond de caisse d'ouverture" — une seule session ouverte à la fois
// par site, pour que le calcul du théorique (fermerCaisse) reste sans ambiguïté.
export function ouvrirCaisse(db: Db, params: OuvrirCaisseParams) {
  if (params.fondOuverture < 0) throw new Error("Le fond de caisse d'ouverture ne peut pas être négatif");

  const dejaOuverte = obtenirClotureOuverte(db, params.siteId);
  if (dejaOuverte) throw new Error("Une session de caisse est déjà ouverte pour ce site");

  return db
    .insert(schema.clotureCaisse)
    .values({ siteId: params.siteId, fondOuverture: params.fondOuverture, ouvertPar: params.userId })
    .returning()
    .get();
}

export function obtenirClotureOuverte(db: Db, siteId: number) {
  return db
    .select()
    .from(schema.clotureCaisse)
    .where(and(eq(schema.clotureCaisse.siteId, siteId), eq(schema.clotureCaisse.statut, "OUVERTE")))
    .get();
}

export function listerClotures(db: Db, siteId: number) {
  return db.select().from(schema.clotureCaisse).where(eq(schema.clotureCaisse.siteId, siteId)).orderBy(desc(schema.clotureCaisse.idCloture)).all();
}

export function obtenirComptagesCloture(db: Db, idCloture: number) {
  return db.select().from(schema.clotureCaisseComptage).where(eq(schema.clotureCaisseComptage.idCloture, idCloture)).all();
}

// 13.1 : "comptage de fermeture, écart théorique/réel par mode de paiement" —
// le théorique CASH inclut le fond d'ouverture (physiquement présent dans le
// tiroir sans être un encaissement) ; les autres modes n'ont pas de fond.
export function fermerCaisse(db: Db, params: FermerCaisseParams) {
  const cloture = db.select().from(schema.clotureCaisse).where(eq(schema.clotureCaisse.idCloture, params.idCloture)).get();
  if (!cloture) throw new Error(`Session de caisse ${params.idCloture} introuvable`);
  if (cloture.statut !== "OUVERTE") throw new Error("Cette session de caisse est déjà fermée");

  const comptages = MODES_PAIEMENT.map((mode) => {
    const paiements = db
      .select({ total: sql<number>`coalesce(sum(${schema.paiement.montant}), 0)` })
      .from(schema.paiement)
      .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
      .where(and(eq(schema.facture.siteId, cloture.siteId), eq(schema.paiement.mode, mode), gte(schema.paiement.datePaiement, cloture.dateOuverture)))
      .get();
    const montantTheorique = (mode === "CASH" ? cloture.fondOuverture : 0) + Number(paiements?.total ?? 0);
    const montantCompte = params.comptages.find((c) => c.mode === mode)?.montantCompte ?? 0;
    return { mode, montantTheorique, montantCompte, ecart: montantCompte - montantTheorique };
  });

  for (const c of comptages) {
    db.insert(schema.clotureCaisseComptage)
      .values({ idCloture: params.idCloture, mode: c.mode, montantTheorique: c.montantTheorique, montantCompte: c.montantCompte, ecart: c.ecart })
      .run();
  }

  const ecartTotal = comptages.reduce((total, c) => total + c.ecart, 0);
  const dateFermeture = new Date().toISOString();

  const clotureFermee = db
    .update(schema.clotureCaisse)
    .set({ statut: "FERMEE", fermePar: params.userId, dateFermeture, ecartTotal })
    .where(eq(schema.clotureCaisse.idCloture, params.idCloture))
    .returning()
    .get();

  // 11.5 : "toute action sensible doit être journalisée" — la clôture fige un écart financier
  db.insert(schema.journalAudit)
    .values({
      utilisateurId: params.userId,
      action: "MODIFICATION",
      tableCible: "cloture_caisse",
      idCible: String(params.idCloture),
      valeurAvant: JSON.stringify({ statut: "OUVERTE" }),
      valeurApres: JSON.stringify({ statut: "FERMEE", ecartTotal }),
    })
    .run();

  return { cloture: clotureFermee!, comptages };
}
