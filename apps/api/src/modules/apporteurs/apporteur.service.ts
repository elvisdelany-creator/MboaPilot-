import { eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverApporteur } from "./apporteur.repository.js";

export interface FicheApporteur {
  apporteur: typeof schema.sousDistributeur.$inferSelect;
  abonnes: (typeof schema.abonne.$inferSelect)[];
  chiffreAffaires: number;
  commissionsCanalplus: (typeof schema.suiviCommissionCanalplus.$inferSelect)[];
}

// 6.3 : fiche apporteur — abonnés référés, CA généré, commissions dues/confirmées/annulées
// (y compris le suivi CANAL+ 4 mois, 6.2)
export function construireFicheApporteur(db: Db, idApporteur: number): FicheApporteur {
  const apporteur = trouverApporteur(db, idApporteur);
  if (!apporteur) throw new Error(`Apporteur ${idApporteur} introuvable`);

  const abonnes = db.select().from(schema.abonne).where(eq(schema.abonne.apporteurId, idApporteur)).all();
  const idsAbonnes = abonnes.map((a) => a.idAbonne);

  const factures =
    idsAbonnes.length > 0
      ? db
          .select()
          .from(schema.facture)
          .where(inArray(schema.facture.idAbonne, idsAbonnes))
          .all()
          .filter((f) => f.statut === "VALIDEE")
      : [];
  const chiffreAffaires = factures.reduce((total, f) => total + f.montantTotal, 0);

  const commissionsCanalplus = db
    .select()
    .from(schema.suiviCommissionCanalplus)
    .where(eq(schema.suiviCommissionCanalplus.apporteurId, idApporteur))
    .all();

  return { apporteur, abonnes, chiffreAffaires, commissionsCanalplus };
}
