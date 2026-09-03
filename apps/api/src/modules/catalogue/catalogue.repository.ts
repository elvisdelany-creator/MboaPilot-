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
