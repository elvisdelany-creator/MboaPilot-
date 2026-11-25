import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { erreurDetailsPaiement, jourDouala } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface CreerPaiementParams {
  idFacture: number;
  mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";
  montant: number;
  utilisateurId: number;
  referenceTransaction?: string;
  banque?: string;
  numeroCheque?: string;
  titulaireCheque?: string;
  dateCheque?: string;
  referenceVirement?: string;
}

// 8.5, 9.2 : un client qui tend plus que le dû se voit rendre la monnaie —
// seul le montant réellement conservé est un encaissement, sinon « Encaissements
// du jour » et le théorique CASH de la clôture de caisse comptent la monnaie
// rendue. Limité au comptant : un chèque, un virement ou un paiement mobile
// ont un montant exact, sans rendu de monnaie.
function montantEncaisseNet(db: Db, params: CreerPaiementParams): number {
  if (params.mode !== "CASH") return params.montant;
  const solde = soldeRestantFacture(db, params.idFacture);
  return solde !== undefined && solde > 0 ? Math.min(params.montant, solde) : params.montant;
}

// ce qui reste dû sur une facture : son total, moins les avoirs émis dessus (montants négatifs), moins les paiements déjà enregistrés
function soldeRestantFacture(db: Db, idFacture: number): number | undefined {
  const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
  if (!facture) return undefined;

  const totalPaye =
    db
      .select({ total: sql<number>`coalesce(sum(${schema.paiement.montant}), 0)` })
      .from(schema.paiement)
      .where(eq(schema.paiement.idFacture, idFacture))
      .get()?.total ?? 0;
  const totalAvoirs =
    db
      .select({ total: sql<number>`coalesce(sum(${schema.facture.montantTotal}), 0)` })
      .from(schema.facture)
      .where(eq(schema.facture.factureOrigineId, idFacture))
      .get()?.total ?? 0;

  return facture.montantTotal + totalAvoirs - totalPaye;
}

// espaces simples (et non l'espace fine insécable d'Intl) : le message s'affiche tel quel
const formaterFcfa = (montant: number) => String(montant).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// 6.5 : un chèque ou un virement a un montant exact, sans monnaie à rendre : au-delà du dû, c'est une faute de saisie (un zéro en trop
// passait, et gonflait les encaissements du jour et le théorique de la clôture). Un paiement partiel reste permis.
function refuserDepassementSansMonnaie(db: Db, params: CreerPaiementParams): void {
  if (params.mode === "CASH" || params.montant <= 0) return;
  const solde = soldeRestantFacture(db, params.idFacture);
  if (solde === undefined || params.montant <= solde) return;
  const libelle = params.mode === "CHEQUE" ? "par chèque" : params.mode === "VIREMENT" ? "par virement" : "par Mobile Money";
  throw new Error(`Le montant ${libelle} (${formaterFcfa(params.montant)} FCFA) dépasse le solde dû de la facture (${formaterFcfa(Math.max(0, solde))} FCFA) : seules les espèces rendent la monnaie`);
}

// 6.6 : un paiement Mobile Money encore ouvert peut aboutir à tout moment. Le statut d'une transaction n'est actualisé qu'à la
// demande (paiement-mobile.service.ts) : c'est la date d'expiration qui dit si elle peut encore aboutir. Jugée sur le seul statut,
// une transaction abandonnée bloquerait la facture pour toujours.
export function paiementMobileEnCours(db: Db, idFacture: number): boolean {
  return db
    .select()
    .from(schema.transactionMobileMoney)
    .where(and(eq(schema.transactionMobileMoney.idFacture, idFacture), inArray(schema.transactionMobileMoney.statut, ["INITIEE", "EN_ATTENTE"])))
    .all()
    .some((t) => new Date(t.dateExpiration).getTime() > Date.now());
}

export const MESSAGE_MOBILE_CONFIRME =
  "Ce paiement Mobile Money a été confirmé par l'opérateur : le client a été débité. Il ne s'annule pas ; corrigez la vente par un avoir avec remboursement";

// transaction que l'opérateur a confirmée sur cette facture (celle d'une référence donnée, ou n'importe laquelle)
export function transactionMobileReussie(db: Db, idFacture: number, reference?: string): boolean {
  return db
    .select()
    .from(schema.transactionMobileMoney)
    .where(and(eq(schema.transactionMobileMoney.idFacture, idFacture), eq(schema.transactionMobileMoney.statut, "REUSSIE")))
    .all()
    .some((t) => reference === undefined || t.referenceTransaction === reference);
}

// textes saisis à la main : sans espaces superflus (« 0012345 » et « 0012345 » doivent se rapprocher), jamais une chaîne vide à la place de « absent »
const nettoyer = (valeur: unknown): string | undefined => (typeof valeur === "string" ? valeur.trim() || undefined : undefined);

// 6.5 : "Comptant" et "Chèque" ont une validation "Immédiate" ; seul le
// "Virement bancaire" est "Différée (rapprochement)" — un virement démarre
// donc EN_ATTENTE de rapprochement, les autres modes n'ont aucun statut
// (null, notion non applicable).
export function creerPaiement(db: Db, params: CreerPaiementParams) {
  // un chèque sans numéro ou un virement sans référence ne se rapproche plus du relevé de banque : la règle des écrans de caisse est aussi celle du
  // serveur, quel que soit le client qui l'appelle. Un remboursement (montant négatif, avoir) sort de l'argent : aucun détail à exiger.
  if (params.montant > 0) {
    const erreur = erreurDetailsPaiement(params, jourDouala());
    if (erreur) throw new Error(erreur);
  }
  // encaisser autrement pendant qu'un Mobile Money peut encore aboutir ferait payer deux fois le client : les 5 000 FCFA en espèces,
  // puis les 5 000 FCFA débités à la confirmation. Un remboursement (montant négatif, avoir) n'est jamais bloqué, et la confirmation
  // du Mobile Money enregistre son propre paiement sans passer ici.
  if (params.montant > 0 && paiementMobileEnCours(db, params.idFacture)) {
    throw new Error("Un paiement Mobile Money est en cours sur cette facture : attendez son résultat avant d'encaisser autrement, sous peine de faire payer le client deux fois");
  }
  refuserDepassementSansMonnaie(db, params);
  return db
    .insert(schema.paiement)
    .values({
      idFacture: params.idFacture,
      mode: params.mode,
      montant: montantEncaisseNet(db, params),
      utilisateurId: params.utilisateurId,
      referenceTransaction: params.referenceTransaction,
      banque: nettoyer(params.banque),
      numeroCheque: nettoyer(params.numeroCheque),
      titulaireCheque: nettoyer(params.titulaireCheque),
      dateCheque: params.dateCheque,
      referenceVirement: nettoyer(params.referenceVirement),
      statutRapprochement: params.mode === "VIREMENT" ? "EN_ATTENTE" : null,
    })
    .returning()
    .get();
}

export function listerPaiementsFacture(db: Db, idFacture: number) {
  return db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, idFacture)).all();
}

// 6.5 : virements encaissés mais pas encore retrouvés sur le relevé bancaire, du plus ancien au plus récent — le comptable les
// vérifie dans cet ordre. Le bouton de rapprochement vivait seulement sur la fiche d'un client : un virement encaissé pour une vente
// sans client enregistré (facture soldée, aucun abonné) ne pouvait plus être rapproché depuis l'application. Jointure gauche sur le
// client pour cette raison. Un remboursement par virement (montant négatif, avoir) attend lui aussi sa confirmation.
const LIMITE_VIREMENTS_A_RAPPROCHER = 200;

export function listerVirementsARapprocher(db: Db, siteId: number, limite = LIMITE_VIREMENTS_A_RAPPROCHER) {
  const enAttente = and(
    eq(schema.facture.siteId, siteId),
    eq(schema.paiement.mode, "VIREMENT"),
    eq(schema.paiement.statutRapprochement, "EN_ATTENTE")
  );
  const total =
    db
      .select({ total: sql<number>`count(*)` })
      .from(schema.paiement)
      .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
      .where(enAttente)
      .get()?.total ?? 0;
  const virements = db
    .select({
      idPaiement: schema.paiement.idPaiement,
      idFacture: schema.paiement.idFacture,
      montant: schema.paiement.montant,
      banque: schema.paiement.banque,
      referenceVirement: schema.paiement.referenceVirement,
      datePaiement: schema.paiement.datePaiement,
      abonnePrenom: schema.abonne.prenom,
      abonneNom: schema.abonne.nom,
      auteurPrenom: schema.utilisateur.prenom,
      auteurNom: schema.utilisateur.nom,
    })
    .from(schema.paiement)
    .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
    .leftJoin(schema.abonne, eq(schema.facture.idAbonne, schema.abonne.idAbonne))
    .leftJoin(schema.utilisateur, eq(schema.paiement.utilisateurId, schema.utilisateur.idUser))
    .where(enAttente)
    .orderBy(asc(schema.paiement.datePaiement), asc(schema.paiement.idPaiement))
    .limit(limite)
    .all();
  return { total, virements };
}

// 6.5 : confirmation manuelle du rapprochement bancaire d'un virement, une
// fois le relevé de banque vérifié — geste réservé à l'encadrement/finance
// (guard gestionRapprochement, app.ts), jamais automatique.
// 11.5 : rapprocher un virement, c'est déclarer l'argent retrouvé sur le relevé de banque, un geste de contrôle financier : la ligne d'audit dit qui l'a
// fait, quand, et de quel état à quel état. Le paiement et sa trace s'écrivent ensemble : sans trace, pas de rapprochement.
export function confirmerRapprochementVirement(db: Db, idPaiement: number, acteurId: number) {
  const paiement = db.select().from(schema.paiement).where(eq(schema.paiement.idPaiement, idPaiement)).get();
  if (!paiement) throw new Error(`Paiement ${idPaiement} introuvable`);
  if (paiement.mode !== "VIREMENT") throw new Error("Seul un paiement par virement peut faire l'objet d'un rapprochement");
  if (paiement.statutRapprochement === "RAPPROCHE") throw new Error("Ce virement est déjà rapproché");

  return db.transaction((tx) => {
    const rapproche = tx.update(schema.paiement).set({ statutRapprochement: "RAPPROCHE" }).where(eq(schema.paiement.idPaiement, idPaiement)).returning().get();
    tx.insert(schema.journalAudit)
      .values({
        utilisateurId: acteurId,
        action: "MODIFICATION",
        tableCible: "paiement",
        idCible: String(idPaiement),
        valeurAvant: JSON.stringify({ statutRapprochement: paiement.statutRapprochement }),
        valeurApres: JSON.stringify({ statutRapprochement: "RAPPROCHE" }),
      })
      .run();
    return rapproche;
  });
}
