import { eq } from "drizzle-orm";
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
