import { desc, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface CreerApporteurInput {
  nom: string;
  telephone?: string;
  tauxCommissionDefaut?: number; // pour-mille
}

// 6.3 : sous-distributeurs et apporteurs d'affaires
export function creerApporteur(db: Db, input: CreerApporteurInput) {
  return db
    .insert(schema.sousDistributeur)
    .values({ nom: input.nom, telephone: input.telephone, tauxCommissionDefaut: input.tauxCommissionDefaut })
    .returning()
    .get();
}

export function trouverApporteur(db: Db, idApporteur: number) {
  return db.select().from(schema.sousDistributeur).where(eq(schema.sousDistributeur.idApporteur, idApporteur)).get();
}

export function listerApporteurs(db: Db) {
  return db.select().from(schema.sousDistributeur).all();
}

export interface ModifierApporteurInput {
  actif?: boolean;
  tauxCommissionDefaut?: number;
}

export function modifierApporteur(db: Db, idApporteur: number, input: ModifierApporteurInput) {
  return db
    .update(schema.sousDistributeur)
    .set({
      ...(input.actif !== undefined && { actif: input.actif ? 1 : 0 }),
      ...(input.tauxCommissionDefaut !== undefined && { tauxCommissionDefaut: input.tauxCommissionDefaut }),
    })
    .where(eq(schema.sousDistributeur.idApporteur, idApporteur))
    .returning()
    .get();
}

export interface EnregistrerReglementCommissionInput {
  apporteurId: number;
  montant: number;
  modePaiement: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";
  reference?: string;
  utilisateurId: number;
}

// 6.3 : "historique de règlement de ses commissions" — trace un paiement
// effectivement versé à l'apporteur (distinct du simple constat CONFIRMEE/
// ANNULEE du suivi CANAL+, 6.2). Aucune validation métier ici (plafond au
// solde restant dû) : c'est la responsabilité de la couche service (6.4-style
// séparation repository/service déjà en usage ailleurs, ex. avoir.service.ts).
export function enregistrerReglementCommission(db: Db, input: EnregistrerReglementCommissionInput) {
  return db
    .insert(schema.reglementCommission)
    .values({
      apporteurId: input.apporteurId,
      montant: input.montant,
      modePaiement: input.modePaiement,
      reference: input.reference,
      utilisateurId: input.utilisateurId,
    })
    .returning()
    .get();
}

export function listerReglementsApporteur(db: Db, idApporteur: number) {
  return db
    .select()
    .from(schema.reglementCommission)
    .where(eq(schema.reglementCommission.apporteurId, idApporteur))
    .orderBy(desc(schema.reglementCommission.idReglement))
    .all();
}
