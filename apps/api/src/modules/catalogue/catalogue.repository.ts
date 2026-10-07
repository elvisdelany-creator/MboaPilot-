import { and, eq } from "drizzle-orm";
import type { Kit as KitCalcul } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { construireKitCalcul } from "./kit-mapper.js";
import { verifierEntier } from "../../lib/validation.js";
import { differencesAudit, journaliserAudit } from "../utilisateurs/audit.repository.js";

export type CatalogueKit = KitCalcul & { idKit: number; idFamille: number; libelle: string };

export interface CatalogueFamille {
  idFamille: number;
  libelle: string;
  formules: (typeof schema.formule.$inferSelect)[];
  kits: CatalogueKit[];
}

// 5.1 : catalogue entièrement paramétrable, organisé par famille d'abonnement.
// Les kits sont enrichis avec les données nécessaires au calcul de prix (5.1.1),
// pour que le frontend réutilise le même moteur (packages/shared) que le backend.
export function listerCatalogue(db: Db): CatalogueFamille[] {
  const familles = db.select().from(schema.familleAbonnement).all();

  return familles.map((famille) => {
    const kits = db.select().from(schema.kit).where(eq(schema.kit.idFamille, famille.idFamille)).all();

    return {
      idFamille: famille.idFamille,
      libelle: famille.libelle,
      formules: db
        .select()
        .from(schema.formule)
        .where(eq(schema.formule.idFamille, famille.idFamille))
        .all()
        .filter((f) => f.actif === 1),
      kits: kits.map((kit) => ({
        idKit: kit.idKit,
        idFamille: kit.idFamille,
        libelle: kit.libelle,
        ...construireKitCalcul(db, kit),
      })),
    };
  });
}

// --- 8.8 : back-office catalogue — familles, formules, options, sans
// intervention développeur (l'édition des règles de prix dynamique des kits
// reste, pour l'instant, réservée aux scripts d'initialisation). Réservé à
// l'Administrateur/Gérant (guard gestionCatalogue, comme pour les produits).

export interface CreerFamilleInput {
  libelle: string;
}

export function creerFamille(db: Db, input: CreerFamilleInput) {
  if (!input.libelle.trim()) throw new Error("Le libellé de la famille est obligatoire");
  return db.insert(schema.familleAbonnement).values({ libelle: input.libelle }).returning().get();
}

export function listerFamilles(db: Db) {
  return db.select().from(schema.familleAbonnement).all();
}

export interface CreerFormuleInput {
  idFamille: number;
  libelle: string;
  prix: number;
  rang: number;
  modeDuree?: "STRICT_30J" | "MOIS_CIVIL";
  dureeCycles?: number;
}

export function creerFormule(db: Db, input: CreerFormuleInput, acteurId: number | null = null) {
  if (!input.libelle.trim()) throw new Error("Le libellé de la formule est obligatoire");
  // 7.4 : un prix négatif se propage tel quel dans le différentiel de
  // migration (cible.prix - actuelle.prix), sans garde-fou de ce côté
  verifierEntier(input.prix, "Le prix de la formule", { requis: true, nullable: false });
  verifierEntier(input.rang, "Le rang de la formule", { requis: true, nullable: false });
  verifierEntier(input.dureeCycles, "La durée en cycles de la formule", { min: 1, nullable: false, message: "La durée en cycles de la formule doit être d'au moins 1" });

  return db.transaction(() => {
    const formule = db
      .insert(schema.formule)
      .values({
        idFamille: input.idFamille,
        libelle: input.libelle,
        prix: input.prix,
        rang: input.rang,
        ...(input.modeDuree !== undefined && { modeDuree: input.modeDuree }),
        ...(input.dureeCycles !== undefined && { dureeCycles: input.dureeCycles }),
      })
      .returning()
      .get();
    journaliserAudit(db, {
      acteurId,
      action: "CREATION",
      tableCible: "formule",
      idCible: formule.idFormule,
      apres: { idFamille: formule.idFamille, libelle: formule.libelle, prix: formule.prix, rang: formule.rang },
    });
    return formule;
  });
}

export interface ModifierFormuleInput {
  libelle?: string;
  prix?: number;
  rang?: number;
  modeDuree?: "STRICT_30J" | "MOIS_CIVIL";
  dureeCycles?: number;
  actif?: boolean;
}

// une formule désactivée reste dans l'historique (abonnements déjà vendus)
// mais disparaît du catalogue de vente (listerCatalogue filtre actif = 1)
export function modifierFormule(db: Db, idFormule: number, input: ModifierFormuleInput, acteurId: number | null = null) {
  if (input.libelle !== undefined && !input.libelle.trim()) throw new Error("Le libellé de la formule est obligatoire");
  verifierEntier(input.prix, "Le prix de la formule", { nullable: false });
  verifierEntier(input.rang, "Le rang de la formule", { nullable: false });
  verifierEntier(input.dureeCycles, "La durée en cycles de la formule", { min: 1, nullable: false, message: "La durée en cycles de la formule doit être d'au moins 1" });

  return db.transaction(() => {
    const avant = db.select().from(schema.formule).where(eq(schema.formule.idFormule, idFormule)).get();
    const apres = db
      .update(schema.formule)
      .set({
        ...(input.libelle !== undefined && { libelle: input.libelle }),
        ...(input.prix !== undefined && { prix: input.prix }),
        ...(input.rang !== undefined && { rang: input.rang }),
        ...(input.modeDuree !== undefined && { modeDuree: input.modeDuree }),
        ...(input.dureeCycles !== undefined && { dureeCycles: input.dureeCycles }),
        ...(input.actif !== undefined && { actif: input.actif ? 1 : 0 }),
      })
      .where(eq(schema.formule.idFormule, idFormule))
      .returning()
      .get();
    if (avant && apres) {
      const diff = differencesAudit(avant, apres, ["libelle", "prix", "rang", "modeDuree", "dureeCycles", "actif"]);
      if (diff) journaliserAudit(db, { acteurId, action: "MODIFICATION", tableCible: "formule", idCible: idFormule, ...diff });
    }
    return apres;
  });
}

// 8.8 : toutes les formules d'une famille, y compris désactivées — pour le
// back-office (listerCatalogue, lui, filtre actif = 1 pour la vente)
export function listerFormules(db: Db, idFamille: number) {
  return db.select().from(schema.formule).where(eq(schema.formule.idFamille, idFamille)).all();
}

export interface CreerOptionInput {
  libelle: string;
  prix: number;
}

export function creerOption(db: Db, input: CreerOptionInput, acteurId: number | null = null) {
  if (!input.libelle.trim()) throw new Error("Le libellé de l'option est obligatoire");
  verifierEntier(input.prix, "Le prix de l'option", { requis: true, nullable: false });
  return db.transaction(() => {
    const option = db.insert(schema.optionComplement).values({ libelle: input.libelle, prix: input.prix }).returning().get();
    journaliserAudit(db, { acteurId, action: "CREATION", tableCible: "option_complement", idCible: option.idOption, apres: { libelle: option.libelle, prix: option.prix } });
    return option;
  });
}

export interface ModifierOptionInput {
  libelle?: string;
  prix?: number;
}

export function modifierOption(db: Db, idOption: number, input: ModifierOptionInput, acteurId: number | null = null) {
  if (input.libelle !== undefined && !input.libelle.trim()) throw new Error("Le libellé de l'option est obligatoire");
  verifierEntier(input.prix, "Le prix de l'option", { nullable: false });

  return db.transaction(() => {
    const avant = db.select().from(schema.optionComplement).where(eq(schema.optionComplement.idOption, idOption)).get();
    const apres = db
      .update(schema.optionComplement)
      .set({
        ...(input.libelle !== undefined && { libelle: input.libelle }),
        ...(input.prix !== undefined && { prix: input.prix }),
      })
      .where(eq(schema.optionComplement.idOption, idOption))
      .returning()
      .get();
    if (avant && apres) {
      const diff = differencesAudit(avant, apres, ["libelle", "prix"]);
      if (diff) journaliserAudit(db, { acteurId, action: "MODIFICATION", tableCible: "option_complement", idCible: idOption, ...diff });
    }
    return apres;
  });
}

export interface OptionAvecCompat {
  idOption: number;
  libelle: string;
  prix: number;
  formulesCompatibles: { idFormule: number; prixSurcharge: number | null }[];
}

export function listerOptions(db: Db): OptionAvecCompat[] {
  const options = db.select().from(schema.optionComplement).all();
  const compats = db.select().from(schema.formuleOptionCompat).all();

  return options.map((option) => ({
    ...option,
    formulesCompatibles: compats
      .filter((c) => c.idOption === option.idOption)
      .map((c) => ({ idFormule: c.idFormule, prixSurcharge: c.prixSurcharge })),
  }));
}

export interface LierOptionFormuleInput {
  idFormule: number;
  idOption: number;
  prixSurcharge?: number;
}

// lie une option à une formule (le prix de surcharge, s'il est fourni,
// remplace le prix par défaut de l'option pour cette formule) — idempotent :
// relier une paire déjà liée met simplement à jour le prix de surcharge
export function lierOptionFormule(db: Db, input: LierOptionFormuleInput, acteurId: number | null = null) {
  verifierEntier(input.prixSurcharge, "Le prix de surcharge de l'option");
  return db.transaction(() => lierOptionFormuleSansTransaction(db, input, acteurId));
}

function lierOptionFormuleSansTransaction(db: Db, input: LierOptionFormuleInput, acteurId: number | null) {
  const idCible = `${input.idFormule}:${input.idOption}`;
  const existant = db
    .select()
    .from(schema.formuleOptionCompat)
    .where(and(eq(schema.formuleOptionCompat.idFormule, input.idFormule), eq(schema.formuleOptionCompat.idOption, input.idOption)))
    .get();

  if (existant) {
    const apres = db
      .update(schema.formuleOptionCompat)
      .set({ prixSurcharge: input.prixSurcharge })
      .where(and(eq(schema.formuleOptionCompat.idFormule, input.idFormule), eq(schema.formuleOptionCompat.idOption, input.idOption)))
      .returning()
      .get();
    const diff = differencesAudit(existant, apres, ["prixSurcharge"]);
    if (diff) journaliserAudit(db, { acteurId, action: "MODIFICATION", tableCible: "formule_option_compat", idCible, ...diff });
    return apres;
  }

  const cree = db
    .insert(schema.formuleOptionCompat)
    .values({ idFormule: input.idFormule, idOption: input.idOption, prixSurcharge: input.prixSurcharge })
    .returning()
    .get();
  journaliserAudit(db, { acteurId, action: "CREATION", tableCible: "formule_option_compat", idCible, apres: { prixSurcharge: cree.prixSurcharge } });
  return cree;
}

export function delierOptionFormule(db: Db, idFormule: number, idOption: number, acteurId: number | null = null) {
  db.transaction(() => {
    const existant = db
      .select()
      .from(schema.formuleOptionCompat)
      .where(and(eq(schema.formuleOptionCompat.idFormule, idFormule), eq(schema.formuleOptionCompat.idOption, idOption)))
      .get();
    db.delete(schema.formuleOptionCompat)
      .where(and(eq(schema.formuleOptionCompat.idFormule, idFormule), eq(schema.formuleOptionCompat.idOption, idOption)))
      .run();
    if (existant) {
      journaliserAudit(db, { acteurId, action: "SUPPRESSION", tableCible: "formule_option_compat", idCible: `${idFormule}:${idOption}`, avant: { prixSurcharge: existant.prixSurcharge } });
    }
  });
}

// 5.1.1, 8.8 : règles de prix dynamique des kits — les trois variantes
// (PRIX_FIXE, PRIX_DECODEUR_VARIABLE_SELON_FORMULE, PRIX_KIT_FIXE_PAR_DIFFERENTIEL)
// portent chacune un sous-ensemble de champs différent, laissés optionnels ici.
export interface CreerKitInput {
  idFamille: number;
  libelle: string;
  reglePrix: "PRIX_FIXE" | "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" | "PRIX_KIT_FIXE_PAR_DIFFERENTIEL";
  prixFixe?: number;
  prixParaboleAccessoires?: number;
  idFormuleReference?: number;
  prixKitReference?: number;
}

// 5.1.1 : un prix négatif sur l'un de ces champs se propage tel quel dans
// calculerPrixKit (packages/shared), quelle que soit la règle de prix
function validerPrixKit(input: { prixFixe?: number; prixParaboleAccessoires?: number; prixKitReference?: number }) {
  verifierEntier(input.prixFixe, "Le prix fixe du kit");
  verifierEntier(input.prixParaboleAccessoires, "Le prix de la parabole/des accessoires du kit");
  verifierEntier(input.prixKitReference, "Le prix de référence du kit");
}

export function creerKit(db: Db, input: CreerKitInput, acteurId: number | null = null) {
  if (!input.libelle.trim()) throw new Error("Le libellé du kit est obligatoire");
  validerPrixKit(input);

  return db.transaction(() => {
    const kit = db
      .insert(schema.kit)
      .values({
        idFamille: input.idFamille,
        libelle: input.libelle,
        reglePrix: input.reglePrix,
        prixFixe: input.prixFixe,
        ...(input.prixParaboleAccessoires !== undefined && { prixParaboleAccessoires: input.prixParaboleAccessoires }),
        idFormuleReference: input.idFormuleReference,
        prixKitReference: input.prixKitReference,
      })
      .returning()
      .get();
    journaliserAudit(db, {
      acteurId,
      action: "CREATION",
      tableCible: "kit",
      idCible: kit.idKit,
      apres: { libelle: kit.libelle, reglePrix: kit.reglePrix, prixFixe: kit.prixFixe, prixParaboleAccessoires: kit.prixParaboleAccessoires, prixKitReference: kit.prixKitReference },
    });
    return kit;
  });
}

export interface ModifierKitInput {
  libelle?: string;
  reglePrix?: "PRIX_FIXE" | "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" | "PRIX_KIT_FIXE_PAR_DIFFERENTIEL";
  prixFixe?: number;
  prixParaboleAccessoires?: number;
  idFormuleReference?: number;
  prixKitReference?: number;
}

export function modifierKit(db: Db, idKit: number, input: ModifierKitInput, acteurId: number | null = null) {
  if (input.libelle !== undefined && !input.libelle.trim()) throw new Error("Le libellé du kit est obligatoire");
  validerPrixKit(input);

  return db.transaction(() => {
    const avant = db.select().from(schema.kit).where(eq(schema.kit.idKit, idKit)).get();
    const apres = db
      .update(schema.kit)
      .set({
        ...(input.libelle !== undefined && { libelle: input.libelle }),
        ...(input.reglePrix !== undefined && { reglePrix: input.reglePrix }),
        ...(input.prixFixe !== undefined && { prixFixe: input.prixFixe }),
        ...(input.prixParaboleAccessoires !== undefined && { prixParaboleAccessoires: input.prixParaboleAccessoires }),
        ...(input.idFormuleReference !== undefined && { idFormuleReference: input.idFormuleReference }),
        ...(input.prixKitReference !== undefined && { prixKitReference: input.prixKitReference }),
      })
      .where(eq(schema.kit.idKit, idKit))
      .returning()
      .get();
    if (avant && apres) {
      const diff = differencesAudit(avant, apres, ["libelle", "reglePrix", "prixFixe", "prixParaboleAccessoires", "idFormuleReference", "prixKitReference"]);
      if (diff) journaliserAudit(db, { acteurId, action: "MODIFICATION", tableCible: "kit", idCible: idKit, ...diff });
    }
    return apres;
  });
}

// 8.8 : kits d'une famille pour le back-office (lignes brutes, à la
// différence de listerCatalogue qui les enrichit pour le calcul de prix, 5.1.1)
export function listerKits(db: Db, idFamille: number) {
  return db.select().from(schema.kit).where(eq(schema.kit.idFamille, idFamille)).all();
}

export interface DefinirPrixDecodeurInput {
  idKit: number;
  idFormule: number;
  prixDecodeur: number;
}

// grille de prix décodeur par formule (règle PRIX_DECODEUR_VARIABLE_SELON_FORMULE) —
// idempotent, comme lierOptionFormule
export function definirPrixDecodeurKit(db: Db, input: DefinirPrixDecodeurInput, acteurId: number | null = null) {
  verifierEntier(input.prixDecodeur, "Le prix du décodeur", { requis: true, nullable: false });
  return db.transaction(() => definirPrixDecodeurKitSansTransaction(db, input, acteurId));
}

function definirPrixDecodeurKitSansTransaction(db: Db, input: DefinirPrixDecodeurInput, acteurId: number | null) {
  const idCible = `${input.idKit}:${input.idFormule}`;
  const existant = db
    .select()
    .from(schema.kitPrixDecodeur)
    .where(and(eq(schema.kitPrixDecodeur.idKit, input.idKit), eq(schema.kitPrixDecodeur.idFormule, input.idFormule)))
    .get();

  if (existant) {
    const apres = db
      .update(schema.kitPrixDecodeur)
      .set({ prixDecodeur: input.prixDecodeur })
      .where(and(eq(schema.kitPrixDecodeur.idKit, input.idKit), eq(schema.kitPrixDecodeur.idFormule, input.idFormule)))
      .returning()
      .get();
    const diff = differencesAudit(existant, apres, ["prixDecodeur"]);
    if (diff) journaliserAudit(db, { acteurId, action: "MODIFICATION", tableCible: "kit_prix_decodeur", idCible, ...diff });
    return apres;
  }

  const cree = db
    .insert(schema.kitPrixDecodeur)
    .values({ idKit: input.idKit, idFormule: input.idFormule, prixDecodeur: input.prixDecodeur })
    .returning()
    .get();
  journaliserAudit(db, { acteurId, action: "CREATION", tableCible: "kit_prix_decodeur", idCible, apres: { prixDecodeur: cree.prixDecodeur } });
  return cree;
}

export function supprimerPrixDecodeurKit(db: Db, idKit: number, idFormule: number, acteurId: number | null = null) {
  db.transaction(() => {
    const existant = db
      .select()
      .from(schema.kitPrixDecodeur)
      .where(and(eq(schema.kitPrixDecodeur.idKit, idKit), eq(schema.kitPrixDecodeur.idFormule, idFormule)))
      .get();
    db.delete(schema.kitPrixDecodeur)
      .where(and(eq(schema.kitPrixDecodeur.idKit, idKit), eq(schema.kitPrixDecodeur.idFormule, idFormule)))
      .run();
    if (existant) {
      journaliserAudit(db, { acteurId, action: "SUPPRESSION", tableCible: "kit_prix_decodeur", idCible: `${idKit}:${idFormule}`, avant: { prixDecodeur: existant.prixDecodeur } });
    }
  });
}

export interface ComposantKitInput {
  idKit: number;
  idProduit: number;
  quantite: number;
}

// 5.1, 5.2 : composition physique d'un kit ("produit composé") — idempotent,
// comme definirPrixDecodeurKit, mais concerne l'inventaire, jamais le prix.
export function definirComposantKit(db: Db, input: ComposantKitInput) {
  verifierEntier(input.quantite, "La quantité du composant", { min: 1, requis: true, nullable: false, message: "La quantité du composant doit être d'au moins 1" });
  const existant = db
    .select()
    .from(schema.kitComposant)
    .where(and(eq(schema.kitComposant.idKit, input.idKit), eq(schema.kitComposant.idProduit, input.idProduit)))
    .get();

  if (existant) {
    return db
      .update(schema.kitComposant)
      .set({ quantite: input.quantite })
      .where(and(eq(schema.kitComposant.idKit, input.idKit), eq(schema.kitComposant.idProduit, input.idProduit)))
      .returning()
      .get();
  }

  return db.insert(schema.kitComposant).values(input).returning().get();
}

export function supprimerComposantKit(db: Db, idKit: number, idProduit: number) {
  db.delete(schema.kitComposant).where(and(eq(schema.kitComposant.idKit, idKit), eq(schema.kitComposant.idProduit, idProduit))).run();
}

export function listerComposantsKit(db: Db, idKit: number) {
  return db.select().from(schema.kitComposant).where(eq(schema.kitComposant.idKit, idKit)).all();
}
