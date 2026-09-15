import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface VerificationFacture {
  facture: {
    idFacture: number;
    dateCreation: string;
    type: "VENTE" | "AVOIR";
    statut: "BROUILLON" | "VALIDEE";
    montantTotal: number;
  };
  entreprise: { nom: string; devise: string };
  site: { nom: string };
  // 8.4 : "état du dossier SAV" — null si la facture n'est rattachée à aucun
  // dossier de réparation (vente ordinaire, abonnement...)
  dossierSav: { statut: string } | null;
}

// 13.1 : "QR code de vérification sur factures et tickets... renvoyant vers
// la fiche numérique de la facture (authenticité, état du dossier SAV)" —
// endpoint public (aucune authentification, voir verification.routes.ts),
// donc volontairement minimal : jamais l'identité du client ni le détail
// des lignes vendues, seulement de quoi confirmer l'authenticité du document.
export function trouverVerificationFacture(db: Db, idFacture: number, jeton: string): VerificationFacture | undefined {
  const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
  if (!facture || facture.jetonVerification !== jeton) return undefined;

  const site = db.select().from(schema.site).where(eq(schema.site.idSite, facture.siteId)).get();
  if (!site) return undefined;
  const entreprise = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, site.idEntreprise)).get();
  if (!entreprise) return undefined;

  const dossierSav = db.select().from(schema.savDossier).where(eq(schema.savDossier.idFacture, idFacture)).get();

  return {
    facture: {
      idFacture: facture.idFacture,
      dateCreation: facture.dateCreation,
      type: facture.type,
      statut: facture.statut,
      montantTotal: facture.montantTotal,
    },
    entreprise: { nom: entreprise.nom, devise: entreprise.devise },
    site: { nom: site.nom },
    dossierSav: dossierSav ? { statut: dossierSav.statut } : null,
  };
}
