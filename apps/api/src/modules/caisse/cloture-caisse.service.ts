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
  if (!Number.isInteger(params.fondOuverture)) throw new Error("Le fond de caisse d'ouverture doit être un montant entier en FCFA");
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
// valide les comptages saisis AVANT toute écriture : un montant illisible ne
// doit ni compter pour 0 (écart fantôme sur tout le tiroir), ni laisser des
// lignes de comptage orphelines si la fermeture échoue en cours de route.
function verifierComptages(comptages: unknown): ComptageInput[] {
  if (!Array.isArray(comptages)) throw new Error("Comptage invalide : la liste des comptages par mode de paiement est obligatoire");
  const modesVus = new Set<string>();
  for (const c of comptages) {
    const mode = c?.mode as string | undefined;
    if (!mode || !(MODES_PAIEMENT as readonly string[]).includes(mode)) throw new Error(`Comptage invalide : mode de paiement inconnu (${String(mode)})`);
    if (modesVus.has(mode)) throw new Error(`Comptage invalide : le mode ${mode} est compté deux fois`);
    modesVus.add(mode);
    if (!Number.isInteger(c.montantCompte) || c.montantCompte < 0) {
      throw new Error(`Comptage invalide : le montant compté (${mode}) doit être un entier positif ou nul en FCFA`);
    }
  }
  return comptages as ComptageInput[];
}

export function fermerCaisse(db: Db, params: FermerCaisseParams) {
  const cloture = db.select().from(schema.clotureCaisse).where(eq(schema.clotureCaisse.idCloture, params.idCloture)).get();
  if (!cloture) throw new Error(`Session de caisse ${params.idCloture} introuvable`);
  if (cloture.statut !== "OUVERTE") throw new Error("Cette session de caisse est déjà fermée");
  const comptagesSaisis = verifierComptages(params.comptages);

  // 13.1 : rien n'empêche un encaissement pendant que la caisse est "fermée"
  // (aucune session ouverte) — le théorique doit donc rattraper tout ce qui a
  // été encaissé depuis la fin de la DERNIÈRE clôture du site (et non depuis
  // l'ouverture de cette session), sous peine de faire disparaître ces
  // encaissements de toute réconciliation (écart fantôme constaté en test).
  const derniereClotureFermee = db
    .select()
    .from(schema.clotureCaisse)
    .where(and(eq(schema.clotureCaisse.siteId, cloture.siteId), eq(schema.clotureCaisse.statut, "FERMEE")))
    .orderBy(desc(schema.clotureCaisse.idCloture))
    .get();
  const depuis = derniereClotureFermee?.dateFermeture ?? "0000-00-00 00:00:00";

  const comptages = MODES_PAIEMENT.map((mode) => {
    const paiements = db
      .select({ total: sql<number>`coalesce(sum(${schema.paiement.montant}), 0)` })
      .from(schema.paiement)
      .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
      .where(and(eq(schema.facture.siteId, cloture.siteId), eq(schema.paiement.mode, mode), gte(schema.paiement.datePaiement, depuis)))
      .get();
    const montantTheorique = (mode === "CASH" ? cloture.fondOuverture : 0) + Number(paiements?.total ?? 0);
    const montantCompte = comptagesSaisis.find((c) => c.mode === mode)?.montantCompte ?? 0;
    return { mode, montantTheorique, montantCompte, ecart: montantCompte - montantTheorique };
  });

  for (const c of comptages) {
    db.insert(schema.clotureCaisseComptage)
      .values({ idCloture: params.idCloture, mode: c.mode, montantTheorique: c.montantTheorique, montantCompte: c.montantCompte, ecart: c.ecart })
      .run();
  }

  const ecartTotal = comptages.reduce((total, c) => total + c.ecart, 0);
  // même format que le défaut SQL datetime('now') des autres colonnes de date
  // (date_ouverture, date_paiement…) — sinon la comparaison de chaînes entre
  // un dateFermeture au format ISO ("...T...Z") et un datePaiement au format
  // SQL ("... ...") est incorrecte dès qu'ils tombent le même jour.
  const dateFermeture = new Date().toISOString().replace("T", " ").slice(0, 19);

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
