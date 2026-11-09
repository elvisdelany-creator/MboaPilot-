import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

// un numéro de série saisi (ou lu à la scanette) : espaces autour retirés, vide = pas de numéro
export function normaliserNumeroSerie(valeur: string | null | undefined): string | undefined {
  const propre = valeur?.trim();
  return propre ? propre : undefined;
}

// 3.2.2, 7.3 : le numéro de série d'un décodeur sert à la garantie et au SAV — il ne peut pas être installé chez deux clients à la fois.
// Un abonnement RÉSILIÉ ne bloque pas sa série : la résiliation ne touche pas au matériel (il reste « ACTIF »), or un décodeur rendu
// est réinstallé chez un autre client. Un abonnement expiré, lui, garde son décodeur (le client va se réabonner).
// `sauf` : l'abonnement qui reçoit le matériel (son propre matériel n'est pas un doublon).
export function exigerNumeroSerieLibre(db: Db, numeroSerie: string | undefined, sauf?: number) {
  if (!numeroSerie) return;
  const autre = db
    .select({ numeroAbonnement: schema.materielAbonne.numeroAbonnement })
    .from(schema.materielAbonne)
    .innerJoin(schema.abonnement, eq(schema.materielAbonne.numeroAbonnement, schema.abonnement.numeroAbonnement))
    .where(
      and(
        eq(schema.materielAbonne.statut, "ACTIF"),
        ne(schema.abonnement.statut, "RESILIE"),
        sql`upper(trim(${schema.materielAbonne.numeroSerie})) = upper(${numeroSerie})`,
        sauf === undefined ? undefined : ne(schema.materielAbonne.numeroAbonnement, sauf),
      ),
    )
    .get();
  if (autre) throw new Error(`Le numéro de série « ${numeroSerie} » est déjà installé sur l'abonnement n° ${autre.numeroAbonnement}`);
}
