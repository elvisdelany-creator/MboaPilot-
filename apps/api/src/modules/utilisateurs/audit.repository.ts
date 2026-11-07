import { and, desc, eq, inArray, lt, lte, ne, or, type SQL } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

const LIMITE_PAR_DEFAUT = 200;
const LIMITE_MAX = 1000;

// la liste n'était pas bornée : 51 Mo de JSON et 100 000 lignes à afficher avec 100 000 entrées
function borneLimite(limite: number | undefined): number {
  if (limite !== undefined && (!Number.isSafeInteger(limite) || limite < 1)) throw new Error("La limite du journal d'audit doit être un entier d'au moins 1");
  return Math.min(limite ?? LIMITE_PAR_DEFAUT, LIMITE_MAX);
}

// 11.5, 8.7 : « qui a fait quoi » se cherche en un seul endroit. Les gestes de gestion tracés dans leurs propres historiques
// (mouvements de stock, statuts/formules/matériel d'abonnement, prix d'article, étapes SAV) sont lus ici avec le journal central,
// sans les écrire une seconde fois : le journal ne grossit pas, et un historique ne peut pas diverger de sa copie.
export interface JournalUnifieFiltre {
  tableCible?: string;
  limite?: number; // 200 par défaut, 1 000 au maximum
  curseur?: string; // le `curseur` de la dernière entrée déjà reçue : uniquement des entrées plus anciennes
}

export interface EntreeJournalUnifiee {
  curseur: string; // unique et stable : clé d'affichage et point de reprise de la pagination
  utilisateurId: number | null;
  utilisateurNom: string | null;
  utilisateurPrenom: string | null;
  action: ActionAudit;
  tableCible: string;
  idCible: string;
  valeurAvant: string | null;
  valeurApres: string | null;
  dateAction: string;
}

// Les sources n'ont pas d'identifiant commun : l'ordre est (date, rang de la source, identifiant) décroissant, et le curseur porte
// ces trois valeurs — un simple « identifiant < » sauterait ou répéterait des entrées au sein de la même seconde.
const RANG_JOURNAL = 1;
const RANG_STOCK = 2;
const RANG_ABONNEMENT = 3;
const RANG_PRIX = 4;
const RANG_SAV = 5;

interface PointCurseur {
  date: string;
  rang: number;
  id: number;
}

function lireCurseur(curseur: string): PointCurseur {
  const correspondance = /^([^|]+)\|(\d+)\|(\d+)$/.exec(curseur);
  if (!correspondance) throw new Error("Le curseur du journal d'audit est invalide");
  return { date: correspondance[1], rang: Number(correspondance[2]), id: Number(correspondance[3]) };
}

// condition « plus ancienne que le curseur » pour une source de rang donné
function apresCurseur(colonneDate: Parameters<typeof lt>[0], colonneId: Parameters<typeof lt>[0], rang: number, point: PointCurseur | undefined): SQL | undefined {
  if (!point) return undefined;
  if (rang < point.rang) return lte(colonneDate, point.date);
  if (rang > point.rang) return lt(colonneDate, point.date);
  return or(lt(colonneDate, point.date), and(eq(colonneDate, point.date), lt(colonneId, point.id)));
}

function nonNul<T extends Record<string, unknown>>(objet: T): Partial<T> {
  return Object.fromEntries(Object.entries(objet).filter(([, valeur]) => valeur !== null && valeur !== undefined)) as Partial<T>;
}

// Jointures gauches, jamais internes : une action système (job quotidien — anonymisation automatique 11.3, expiration d'abonnement)
// s'écrit avec utilisateur_id NULL, et une jointure interne exclurait silencieusement ces entrées, cachant précisément les actions
// les plus sensibles à tracer. Le journal et les historiques ne sont lus qu'ici : jamais de UPDATE/DELETE applicatif (immuables).
export function listerJournalUnifie(db: Db, filtre: JournalUnifieFiltre = {}): EntreeJournalUnifiee[] {
  const limite = borneLimite(filtre.limite);
  const point = filtre.curseur !== undefined ? lireCurseur(filtre.curseur) : undefined;
  const voulue = (table: string) => filtre.tableCible === undefined || filtre.tableCible === "" || filtre.tableCible === table;

  const entrees: (EntreeJournalUnifiee & { rang: number; id: number })[] = [];
  const ajouter = (rang: number, id: number, entree: Omit<EntreeJournalUnifiee, "curseur">) =>
    entrees.push({ ...entree, curseur: `${entree.dateAction}|${rang}|${id}`, rang, id });
  const auteur = { nom: schema.utilisateur.nom, prenom: schema.utilisateur.prenom };

  // journal central
  {
    const conditions = [];
    if (filtre.tableCible) conditions.push(eq(schema.journalAudit.tableCible, filtre.tableCible));
    const reprise = apresCurseur(schema.journalAudit.dateAction, schema.journalAudit.idAudit, RANG_JOURNAL, point);
    if (reprise) conditions.push(reprise);
    const lignes = db
      .select({ ...auteur, ligne: schema.journalAudit })
      .from(schema.journalAudit)
      .leftJoin(schema.utilisateur, eq(schema.journalAudit.utilisateurId, schema.utilisateur.idUser))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.journalAudit.dateAction), desc(schema.journalAudit.idAudit))
      .limit(limite)
      .all();
    for (const { ligne, nom, prenom } of lignes) {
      ajouter(RANG_JOURNAL, ligne.idAudit, {
        utilisateurId: ligne.utilisateurId,
        utilisateurNom: nom,
        utilisateurPrenom: prenom,
        action: ligne.action,
        tableCible: ligne.tableCible,
        idCible: ligne.idCible,
        valeurAvant: ligne.valeurAvant,
        valeurApres: ligne.valeurApres,
        dateAction: ligne.dateAction,
      });
    }
  }

  // mouvements de stock : les gestes voulus (achat, casse, inventaire, transfert, retour) — la sortie d'une vente découle de sa facture
  if (voulue("stock_mouvement")) {
    const reprise = apresCurseur(schema.stockMouvement.dateMouvement, schema.stockMouvement.idMouvement, RANG_STOCK, point);
    const lignes = db
      .select({ ...auteur, mouvement: schema.stockMouvement, article: schema.produit.libelle })
      .from(schema.stockMouvement)
      .leftJoin(schema.utilisateur, eq(schema.stockMouvement.utilisateurId, schema.utilisateur.idUser))
      .leftJoin(schema.produit, eq(schema.stockMouvement.idProduit, schema.produit.idProduit))
      .where(and(ne(schema.stockMouvement.typeMouvement, "VENTE"), reprise))
      .orderBy(desc(schema.stockMouvement.dateMouvement), desc(schema.stockMouvement.idMouvement))
      .limit(limite)
      .all();
    for (const { mouvement, nom, prenom, article } of lignes) {
      ajouter(RANG_STOCK, mouvement.idMouvement, {
        utilisateurId: mouvement.utilisateurId,
        utilisateurNom: nom,
        utilisateurPrenom: prenom,
        action: "CREATION",
        tableCible: "stock_mouvement",
        idCible: String(mouvement.idMouvement),
        valeurAvant: null,
        valeurApres: JSON.stringify({ article, typeMouvement: mouvement.typeMouvement, quantite: mouvement.quantite, ...nonNul({ motif: mouvement.motif }) }),
        dateAction: mouvement.dateMouvement,
      });
    }
  }

  // statut, formule, option et matériel d'un abonnement (y compris les passages automatiques à « expiré », auteur NULL)
  if (voulue("historique_abonnement")) {
    const reprise = apresCurseur(schema.historiqueAbonnement.dateChangement, schema.historiqueAbonnement.idHisto, RANG_ABONNEMENT, point);
    const lignes = db
      .select({ ...auteur, histo: schema.historiqueAbonnement })
      .from(schema.historiqueAbonnement)
      .leftJoin(schema.utilisateur, eq(schema.historiqueAbonnement.utilisateurId, schema.utilisateur.idUser))
      .where(reprise)
      .orderBy(desc(schema.historiqueAbonnement.dateChangement), desc(schema.historiqueAbonnement.idHisto))
      .limit(limite)
      .all();
    // la formule est stockée par numéro : l'écran doit afficher son nom
    const numerosFormules = lignes.filter((l) => l.histo.typeChangement === "FORMULE").flatMap((l) => [l.histo.valeurAvant, l.histo.valeurApres]).map(Number).filter(Number.isInteger);
    const nomsFormules = new Map(
      (numerosFormules.length > 0 ? db.select().from(schema.formule).where(inArray(schema.formule.idFormule, numerosFormules)).all() : []).map((f) => [String(f.idFormule), f.libelle])
    );
    const CHAMP_PAR_TYPE = { STATUT: "statut", FORMULE: "formule", OPTION: "options", MATERIEL: "numeroSerie" } as const;
    for (const { histo, nom, prenom } of lignes) {
      const champ = CHAMP_PAR_TYPE[histo.typeChangement];
      const valeur = (brute: string | null) => (histo.typeChangement === "FORMULE" && brute !== null ? (nomsFormules.get(brute) ?? brute) : brute);
      ajouter(RANG_ABONNEMENT, histo.idHisto, {
        utilisateurId: histo.utilisateurId,
        utilisateurNom: nom,
        utilisateurPrenom: prenom,
        action: "MODIFICATION",
        tableCible: "historique_abonnement",
        idCible: String(histo.numeroAbonnement),
        valeurAvant: JSON.stringify({ [champ]: valeur(histo.valeurAvant) }),
        valeurApres: JSON.stringify({ [champ]: valeur(histo.valeurApres), ...nonNul({ motif: histo.motif }) }),
        dateAction: histo.dateChangement,
      });
    }
  }

  // prix de vente et coût de revient d'un article
  if (voulue("historique_prix_produit")) {
    const reprise = apresCurseur(schema.historiquePrixProduit.dateChangement, schema.historiquePrixProduit.idHistoPrix, RANG_PRIX, point);
    const lignes = db
      .select({ ...auteur, histo: schema.historiquePrixProduit, article: schema.produit.libelle })
      .from(schema.historiquePrixProduit)
      .leftJoin(schema.utilisateur, eq(schema.historiquePrixProduit.utilisateurId, schema.utilisateur.idUser))
      .leftJoin(schema.produit, eq(schema.historiquePrixProduit.idProduit, schema.produit.idProduit))
      .where(reprise)
      .orderBy(desc(schema.historiquePrixProduit.dateChangement), desc(schema.historiquePrixProduit.idHistoPrix))
      .limit(limite)
      .all();
    for (const { histo, nom, prenom, article } of lignes) {
      ajouter(RANG_PRIX, histo.idHistoPrix, {
        utilisateurId: histo.utilisateurId,
        utilisateurNom: nom,
        utilisateurPrenom: prenom,
        action: "MODIFICATION",
        tableCible: "historique_prix_produit",
        idCible: String(histo.idProduit),
        valeurAvant: JSON.stringify({ article, prixVente: histo.prixVenteAvant, coutRevient: histo.coutRevientAvant }),
        valeurApres: JSON.stringify({ article, prixVente: histo.prixVenteApres, coutRevient: histo.coutRevientApres }),
        dateAction: histo.dateChangement,
      });
    }
  }

  // étapes d'un dossier SAV
  if (voulue("sav_historique")) {
    const reprise = apresCurseur(schema.savHistorique.dateChangement, schema.savHistorique.idHistoSav, RANG_SAV, point);
    const lignes = db
      .select({ ...auteur, histo: schema.savHistorique })
      .from(schema.savHistorique)
      .leftJoin(schema.utilisateur, eq(schema.savHistorique.utilisateurId, schema.utilisateur.idUser))
      .where(reprise)
      .orderBy(desc(schema.savHistorique.dateChangement), desc(schema.savHistorique.idHistoSav))
      .limit(limite)
      .all();
    for (const { histo, nom, prenom } of lignes) {
      ajouter(RANG_SAV, histo.idHistoSav, {
        utilisateurId: histo.utilisateurId,
        utilisateurNom: nom,
        utilisateurPrenom: prenom,
        action: histo.statutAvant === null ? "CREATION" : "MODIFICATION",
        tableCible: "sav_historique",
        idCible: String(histo.idDossierSav),
        valeurAvant: histo.statutAvant === null ? null : JSON.stringify({ statut: histo.statutAvant }),
        valeurApres: JSON.stringify({ statut: histo.statutApres, ...nonNul({ motif: histo.motif }) }),
        dateAction: histo.dateChangement,
      });
    }
  }

  // chaque source a fourni ses `limite` plus récentes : les `limite` plus récentes de l'ensemble en font nécessairement partie
  return entrees
    .sort((a, b) => b.dateAction.localeCompare(a.dateAction) || b.rang - a.rang || b.id - a.id)
    .slice(0, limite)
    .map(({ rang: _rang, id: _id, ...entree }) => entree);
}

export type ActionAudit = "CREATION" | "MODIFICATION" | "SUPPRESSION";

// 11.5 : écrit une ligne immuable du journal d'audit (auteur, horodatage, valeurs
// avant/après). `acteurId` null = action système.
export function journaliserAudit(
  db: Db,
  params: { acteurId: number | null; action: ActionAudit; tableCible: string; idCible: string | number; avant?: unknown; apres?: unknown }
): void {
  db.insert(schema.journalAudit)
    .values({
      utilisateurId: params.acteurId,
      action: params.action,
      tableCible: params.tableCible,
      idCible: String(params.idCible),
      ...(params.avant !== undefined && { valeurAvant: JSON.stringify(params.avant) }),
      ...(params.apres !== undefined && { valeurApres: JSON.stringify(params.apres) }),
    })
    .run();
}

// Champs réellement modifiés entre deux états : null quand rien ne change, pour ne
// pas polluer le journal avec des « modifications » identiques.
export function differencesAudit(
  avant: Record<string, unknown>,
  apres: Record<string, unknown>,
  champs: readonly string[]
): { avant: Record<string, unknown>; apres: Record<string, unknown> } | null {
  const diffAvant: Record<string, unknown> = {};
  const diffApres: Record<string, unknown> = {};
  for (const champ of champs) {
    if (!Object.is(avant[champ], apres[champ])) {
      diffAvant[champ] = avant[champ];
      diffApres[champ] = apres[champ];
    }
  }
  return Object.keys(diffAvant).length > 0 ? { avant: diffAvant, apres: diffApres } : null;
}
