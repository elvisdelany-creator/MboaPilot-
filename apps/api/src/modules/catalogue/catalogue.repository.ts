import { and, eq } from "drizzle-orm";
import type { Kit as KitCalcul } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { construireKitCalcul } from "./kit-mapper.js";

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

export function creerFormule(db: Db, input: CreerFormuleInput) {
  return db
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
export function modifierFormule(db: Db, idFormule: number, input: ModifierFormuleInput) {
  return db
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

export function creerOption(db: Db, input: CreerOptionInput) {
  return db.insert(schema.optionComplement).values({ libelle: input.libelle, prix: input.prix }).returning().get();
}

export interface ModifierOptionInput {
  libelle?: string;
  prix?: number;
}

export function modifierOption(db: Db, idOption: number, input: ModifierOptionInput) {
  return db
    .update(schema.optionComplement)
    .set({
      ...(input.libelle !== undefined && { libelle: input.libelle }),
      ...(input.prix !== undefined && { prix: input.prix }),
    })
    .where(eq(schema.optionComplement.idOption, idOption))
    .returning()
    .get();
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
export function lierOptionFormule(db: Db, input: LierOptionFormuleInput) {
  const existant = db
    .select()
    .from(schema.formuleOptionCompat)
    .where(and(eq(schema.formuleOptionCompat.idFormule, input.idFormule), eq(schema.formuleOptionCompat.idOption, input.idOption)))
    .get();

  if (existant) {
    return db
      .update(schema.formuleOptionCompat)
      .set({ prixSurcharge: input.prixSurcharge })
      .where(and(eq(schema.formuleOptionCompat.idFormule, input.idFormule), eq(schema.formuleOptionCompat.idOption, input.idOption)))
      .returning()
      .get();
  }

  return db
    .insert(schema.formuleOptionCompat)
    .values({ idFormule: input.idFormule, idOption: input.idOption, prixSurcharge: input.prixSurcharge })
    .returning()
    .get();
}

export function delierOptionFormule(db: Db, idFormule: number, idOption: number) {
  db.delete(schema.formuleOptionCompat)
    .where(and(eq(schema.formuleOptionCompat.idFormule, idFormule), eq(schema.formuleOptionCompat.idOption, idOption)))
    .run();
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

export function creerKit(db: Db, input: CreerKitInput) {
  return db
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
}

export interface ModifierKitInput {
  libelle?: string;
  reglePrix?: "PRIX_FIXE" | "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" | "PRIX_KIT_FIXE_PAR_DIFFERENTIEL";
  prixFixe?: number;
  prixParaboleAccessoires?: number;
  idFormuleReference?: number;
  prixKitReference?: number;
}

export function modifierKit(db: Db, idKit: number, input: ModifierKitInput) {
  return db
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
export function definirPrixDecodeurKit(db: Db, input: DefinirPrixDecodeurInput) {
  const existant = db
    .select()
    .from(schema.kitPrixDecodeur)
    .where(and(eq(schema.kitPrixDecodeur.idKit, input.idKit), eq(schema.kitPrixDecodeur.idFormule, input.idFormule)))
    .get();

  if (existant) {
    return db
      .update(schema.kitPrixDecodeur)
      .set({ prixDecodeur: input.prixDecodeur })
      .where(and(eq(schema.kitPrixDecodeur.idKit, input.idKit), eq(schema.kitPrixDecodeur.idFormule, input.idFormule)))
      .returning()
      .get();
  }

  return db
    .insert(schema.kitPrixDecodeur)
    .values({ idKit: input.idKit, idFormule: input.idFormule, prixDecodeur: input.prixDecodeur })
    .returning()
    .get();
}

export function supprimerPrixDecodeurKit(db: Db, idKit: number, idFormule: number) {
  db.delete(schema.kitPrixDecodeur)
    .where(and(eq(schema.kitPrixDecodeur.idKit, idKit), eq(schema.kitPrixDecodeur.idFormule, idFormule)))
    .run();
}
