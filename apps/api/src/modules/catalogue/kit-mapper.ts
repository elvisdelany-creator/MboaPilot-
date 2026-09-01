import { eq } from "drizzle-orm";
import type { Kit as KitCalcul } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

// construit le type calculable partagé (packages/shared) à partir d'une ligne kit en base —
// factorisé pour être utilisé à la fois par le recrutement et la lecture du catalogue.
export function construireKitCalcul(db: Db, kitRow: typeof schema.kit.$inferSelect): KitCalcul {
  switch (kitRow.reglePrix) {
    case "PRIX_FIXE":
      return { reglePrix: "PRIX_FIXE", prixFixe: kitRow.prixFixe ?? 0 };
    case "PRIX_DECODEUR_VARIABLE_SELON_FORMULE": {
      const lignes = db.select().from(schema.kitPrixDecodeur).where(eq(schema.kitPrixDecodeur.idKit, kitRow.idKit)).all();
      return {
        reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE",
        prixParaboleAccessoires: kitRow.prixParaboleAccessoires,
        prixDecodeurParFormule: Object.fromEntries(lignes.map((l) => [l.idFormule, l.prixDecodeur])),
      };
    }
    case "PRIX_KIT_FIXE_PAR_DIFFERENTIEL": {
      const formuleRef = db
        .select()
        .from(schema.formule)
        .where(eq(schema.formule.idFormule, kitRow.idFormuleReference!))
        .get();
      if (!formuleRef) throw new Error(`Formule de référence introuvable pour le kit ${kitRow.idKit}`);
      return {
        reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL",
        prixKitReference: kitRow.prixKitReference ?? 0,
        formuleReference: { idFormule: formuleRef.idFormule, prix: formuleRef.prix },
      };
    }
  }
}
