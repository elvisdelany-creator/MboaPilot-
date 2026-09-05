import { analyserCsv, construireCsv } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import { listerProduits, creerProduit, modifierProduit, type CreerProduitInput } from "./produit.repository.js";

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
  return construireCsv([...COLONNES], lignes);
}

export interface ErreurImportCsv {
  ligne: number; // 1-based, en-tête exclue (première ligne de données = 2 dans le fichier)
  message: string;
}

export interface ResultatImportCsv {
  crees: number;
  misAJour: number;
  erreurs: ErreurImportCsv[];
}

// 8.2 : import de catalogue (CSV) — associe chaque ligne à un article
// existant du site par libellé (insensible à la casse) pour une mise à jour
// tarifaire, sinon crée un nouvel article. Une ligne invalide est rapportée
// sans interrompre le traitement des lignes suivantes.
export function importerCatalogueCsv(db: Db, siteId: number, contenuCsv: string, userId: number): ResultatImportCsv {
  const lignes = analyserCsv(contenuCsv);
  if (lignes.length > 0) {
    const colonnesManquantes = COLONNES.filter((c) => !(c in lignes[0]));
    if (colonnesManquantes.length > 0) {
      throw new Error(`Colonnes obligatoires manquantes dans le CSV : ${colonnesManquantes.join(", ")}`);
    }
  }

  const produitsExistants = listerProduits(db, siteId);
  const parLibelleMinuscule = new Map(produitsExistants.map((p) => [p.libelle.toLowerCase(), p]));

  const resultat: ResultatImportCsv = { crees: 0, misAJour: 0, erreurs: [] };

  lignes.forEach((ligne, index) => {
    const numeroLigne = index + 2; // +1 pour l'en-tête, +1 pour l'index 1-based
    try {
      const input = analyserLigneCsv(ligne);
      const existant = parLibelleMinuscule.get(input.libelle.toLowerCase());
      if (existant) {
        modifierProduit(db, existant.idProduit, {
          categorie: input.categorie,
          prixVente: input.prixVente,
          coutRevient: input.coutRevient,
          seuilAlerte: input.seuilAlerte,
          userId,
        });
        resultat.misAJour++;
      } else {
        const cree = creerProduit(db, { siteId, ...input });
        parLibelleMinuscule.set(cree.libelle.toLowerCase(), cree);
        resultat.crees++;
      }
    } catch (erreur) {
      resultat.erreurs.push({ ligne: numeroLigne, message: erreur instanceof Error ? erreur.message : "Ligne invalide" });
    }
  });

  return resultat;
}

function analyserLigneCsv(ligne: Record<string, string>): Omit<CreerProduitInput, "siteId"> {
  const type = ligne.Type.trim().toUpperCase();
  if (!(TYPES_VALIDES as readonly string[]).includes(type)) {
    throw new Error(`Type invalide "${ligne.Type}" — attendu : ${TYPES_VALIDES.join(", ")}`);
  }
  const libelle = ligne.Libelle.trim();
  if (!libelle) throw new Error("Libellé obligatoire");

  const prixVente = Number(ligne.PrixVente);
  if (!Number.isFinite(prixVente) || prixVente < 0) throw new Error(`Prix de vente invalide "${ligne.PrixVente}"`);

  const coutRevient = ligne.CoutRevient.trim() === "" ? undefined : Number(ligne.CoutRevient);
  if (coutRevient !== undefined && !Number.isFinite(coutRevient)) throw new Error(`Coût de revient invalide "${ligne.CoutRevient}"`);

  const seuilAlerte = ligne.SeuilAlerte.trim() === "" ? undefined : Number(ligne.SeuilAlerte);
  if (seuilAlerte !== undefined && !Number.isFinite(seuilAlerte)) throw new Error(`Seuil d'alerte invalide "${ligne.SeuilAlerte}"`);

  return {
    type: type as CreerProduitInput["type"],
    libelle,
    categorie: ligne.Categorie.trim() || undefined,
    prixVente,
    coutRevient,
    suiviStock: ligne.SuiviStock.trim() === "1",
    seuilAlerte,
  };
}
