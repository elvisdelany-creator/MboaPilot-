import { analyserCsv, construireCsv, normaliserLibelle } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import { listerProduits, creerProduit, modifierProduit, type CreerProduitInput } from "./produit.repository.js";
import { enregistrerMouvement } from "../stock/stock.repository.js";
import { cederLaMain } from "../../lib/ceder-la-main.js";

const COLONNES = ["Type", "Libelle", "Categorie", "PrixVente", "CoutRevient", "SuiviStock", "SeuilAlerte"] as const;
const TYPES_VALIDES = ["BIEN", "SERVICE", "SAV", "KIT"] as const;

// 8.2 : export de catalogue (CSV) — pour initialisation ou mise à jour
// tarifaire en masse dans un tableur, puis réimport (voir importerCatalogueCsv).
export function exporterCatalogueCsv(db: Db, siteId: number): string {
  const produits = listerProduits(db, siteId);
  const lignes = produits.map((p) => [
    p.type,
    p.libelle,
    p.categorie ?? "",
    p.prixVente,
    p.coutRevient,
    p.suiviStock,
    p.seuilAlerte ?? "",
  ]);
  // « ; » plutôt que « , » : Excel en version française n'ouvre sinon qu'une seule colonne
  return construireCsv([...COLONNES], lignes, ";");
}

export interface ErreurImportCsv {
  ligne: number; // 1-based, en-tête exclue (première ligne de données = 2 dans le fichier)
  message: string;
}

export interface ResultatImportCsv {
  crees: number;
  misAJour: number;
  erreurs: ErreurImportCsv[];
  // colonne facultative « Stock » : articles créés dont la quantité de départ a été enregistrée, et lignes d'articles déjà existants
  // dont la quantité a été ignorée (l'import ne modifie jamais le stock d'un article existant)
  stockInitialise: number;
  stockIgnore: number;
}

// 8.2 : import de catalogue (CSV) — associe chaque ligne à un article
// existant du site par libellé (insensible à la casse) pour une mise à jour
// tarifaire, sinon crée un nouvel article. Une ligne invalide est rapportée
// sans interrompre le traitement des lignes suivantes.
export function importerCatalogueCsv(db: Db, siteId: number, contenuCsv: string, userId: number): ResultatImportCsv {
  const contexte = preparerImport(db, siteId, contenuCsv, userId);
  // une seule transaction pour tout le fichier : un import interrompu (coupure de courant) ne laisse jamais un catalogue à moitié
  // importé. Pour un petit fichier ou un test ; la route, elle, passe par importerCatalogueCsvCedant (voir plus bas).
  importerTranche(db, contexte, 0, contexte.lignes.length);
  return contexte.resultat;
}

// Importer 20 000 articles prend environ 9 secondes d'un seul bloc (0,4 ms par ligne, surtout la construction des requêtes) : le serveur
// de la caisse ne répond plus à personne pendant ce temps. Le fichier est donc traité par tranches de 200 lignes (une centaine de
// millisecondes chacune), avec une pause entre deux tranches pour laisser passer les autres requêtes.
// Une transaction par tranche, et non plus une seule pour tout le fichier : un import interrompu en plein milieu (coupure de courant)
// laisse les tranches déjà écrites. Il se rejoue sans risque : les articles déjà créés sont reconnus par leur libellé et simplement mis
// à jour, la quantité de départ d'un article existant n'est jamais touchée.
const LIGNES_PAR_TRANCHE = 200;

export interface OptionsImportCsv {
  lignesParTranche?: number;
}

export async function importerCatalogueCsvCedant(db: Db, siteId: number, contenuCsv: string, userId: number, options: OptionsImportCsv = {}): Promise<ResultatImportCsv> {
  const contexte = preparerImport(db, siteId, contenuCsv, userId);
  const taille = Math.max(1, Math.floor(options.lignesParTranche ?? LIGNES_PAR_TRANCHE));
  for (let debut = 0; debut < contexte.lignes.length; debut += taille) {
    importerTranche(db, contexte, debut, Math.min(debut + taille, contexte.lignes.length));
    await cederLaMain();
  }
  return contexte.resultat;
}

interface ContexteImport {
  siteId: number;
  userId: number;
  lignes: Record<string, string>[];
  parLibelleMinuscule: Map<string, ReturnType<typeof listerProduits>[number]>;
  resultat: ResultatImportCsv;
}

// lecture du fichier et contrôle des colonnes : rien n'est écrit tant que l'en-tête n'est pas bon
function preparerImport(db: Db, siteId: number, contenuCsv: string, userId: number): ContexteImport {
  // un nombre, un tableau ou un objet à la place du texte étaient parcourus comme un texte, ou faisaient échouer l'analyse sans dire pourquoi
  if (typeof contenuCsv !== "string") throw new Error("Le contenu du fichier CSV est obligatoire (un texte)");
  const lignes = analyserCsv(contenuCsv);
  if (lignes.length > 0) {
    const colonnesManquantes = COLONNES.filter((c) => !(c in lignes[0]));
    if (colonnesManquantes.length > 0) {
      throw new Error(`Colonnes obligatoires manquantes dans le CSV : ${colonnesManquantes.join(", ")}`);
    }
  }

  const produitsExistants = listerProduits(db, siteId);
  const parLibelleMinuscule = new Map(produitsExistants.map((p) => [normaliserLibelle(p.libelle), p]));
  const resultat: ResultatImportCsv = { crees: 0, misAJour: 0, erreurs: [], stockInitialise: 0, stockIgnore: 0 };
  return { siteId, userId, lignes, parLibelleMinuscule, resultat };
}

// Traite les lignes [debut, fin) dans une transaction. Chaque ligne a son propre point de reprise : une ligne invalide est
// rapportée et annulée seule, sans bloquer les suivantes.
function importerTranche(db: Db, contexte: ContexteImport, debut: number, fin: number): void {
  const { siteId, userId, lignes, parLibelleMinuscule, resultat } = contexte;
  db.transaction(() => {
    lignes.slice(debut, fin).forEach((ligne, decalage) => {
      const numeroLigne = debut + decalage + 2; // +1 pour l'en-tête, +1 pour l'index 1-based
      try {
        db.transaction(() => {
          const { stockInitial, ...input } = analyserLigneCsv(ligne);
          const existant = parLibelleMinuscule.get(normaliserLibelle(input.libelle));
          if (existant) {
            modifierProduit(db, existant.idProduit, {
              categorie: input.categorie,
              prixVente: input.prixVente,
              coutRevient: input.coutRevient,
              seuilAlerte: input.seuilAlerte,
              userId,
            });
            resultat.misAJour++;
            // le stock d'un article existant a vécu depuis : réimporter un vieux fichier pour changer des prix ne doit pas le remettre à zéro
            if (stockInitial !== undefined && stockInitial > 0) resultat.stockIgnore++;
          } else {
            if (stockInitial !== undefined && stockInitial > 0 && !input.suiviStock) {
              throw new Error("Un stock initial ne peut être saisi que pour un article suivi en stock (SuiviStock = 1)");
            }
            const cree = creerProduit(db, { siteId, ...input });
            parLibelleMinuscule.set(normaliserLibelle(cree.libelle), cree);
            resultat.crees++;
            // la quantité de départ, tracée comme n'importe quel ajustement d'inventaire (visible au journal d'audit)
            if (stockInitial !== undefined && stockInitial > 0) {
              enregistrerMouvement(db, { idProduit: cree.idProduit, siteId, typeMouvement: "INVENTAIRE", quantite: stockInitial, motif: "Stock initial (import CSV)", utilisateurId: userId });
              resultat.stockInitialise++;
            }
          }
        });
      } catch (erreur) {
        resultat.erreurs.push({ ligne: numeroLigne, message: erreur instanceof Error ? erreur.message : "Ligne invalide" });
      }
    });
  });
}

function lireEntierPositif(valeur: string): number | undefined {
  const texte = valeur.trim();
  return /^\d+$/.test(texte) ? Number(texte) : undefined;
}

function analyserLigneCsv(ligne: Record<string, string>): Omit<CreerProduitInput, "siteId"> & { stockInitial?: number } {
  const type = ligne.Type.trim().toUpperCase();
  if (!(TYPES_VALIDES as readonly string[]).includes(type)) {
    throw new Error(`Type invalide "${ligne.Type}" — attendu : ${TYPES_VALIDES.join(", ")}`);
  }
  const libelle = ligne.Libelle.trim();
  if (!libelle) throw new Error("Libellé obligatoire");

  // Number("") vaut 0 : une cellule vide serait lue comme « 0 FCFA » (et
  // écraserait le prix d'un article existant) — seuls des entiers explicites
  // sont acceptés ; coût et seuil vides restent « non renseignés ».
  const prixVente = lireEntierPositif(ligne.PrixVente);
  if (prixVente === undefined) throw new Error(`Prix de vente invalide "${ligne.PrixVente}" — entier en FCFA obligatoire`);

  const coutRevient = ligne.CoutRevient.trim() === "" ? undefined : lireEntierPositif(ligne.CoutRevient);
  if (ligne.CoutRevient.trim() !== "" && coutRevient === undefined) throw new Error(`Coût de revient invalide "${ligne.CoutRevient}"`);

  const seuilAlerte = ligne.SeuilAlerte.trim() === "" ? undefined : lireEntierPositif(ligne.SeuilAlerte);
  if (ligne.SeuilAlerte.trim() !== "" && seuilAlerte === undefined) throw new Error(`Seuil d'alerte invalide "${ligne.SeuilAlerte}"`);

  // colonne facultative : absente ou vide = pas de stock initial ; sinon un entier >= 0 (un « -3 » ou « 2,5 » est une faute de frappe)
  const brutStock = ligne.Stock?.trim() ?? "";
  const stockInitial = brutStock === "" ? undefined : lireEntierPositif(brutStock);
  if (brutStock !== "" && stockInitial === undefined) throw new Error(`Stock initial invalide "${ligne.Stock}" — entier positif ou nul attendu`);

  // « oui », « TRUE » ou « 2 » étaient lus comme « non suivi » sans un mot : l'article ne décomptait alors plus son stock et le commerçant
  // ne s'en apercevait pas. Seuls 1 (suivi) et 0 ou vide (non suivi) sont acceptés ; le reste est une faute de frappe qu'on signale.
  const brutSuivi = ligne.SuiviStock.trim();
  if (brutSuivi !== "" && brutSuivi !== "0" && brutSuivi !== "1") {
    throw new Error(`SuiviStock invalide "${ligne.SuiviStock}" — 1 (article suivi en stock) ou 0 (non suivi) attendu`);
  }

  return {
    type: type as CreerProduitInput["type"],
    libelle,
    categorie: ligne.Categorie.trim() || undefined,
    prixVente,
    coutRevient,
    suiviStock: brutSuivi === "1",
    seuilAlerte,
    stockInitial,
  };
}
