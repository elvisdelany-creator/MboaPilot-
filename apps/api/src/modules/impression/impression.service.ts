import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { construireTicketEscPos, type TicketEscPosInput } from "./escpos.js";
import type { FournisseurImpression } from "./fournisseur.js";

const PORT_PAR_DEFAUT = 9100; // "RAW/JetDirect" — port standard des imprimantes réseau

export interface ImprimerTicketParams {
  siteId: number;
  ticket: Omit<TicketEscPosInput, "entreprise" | "site">;
}

export interface ImprimerTicketResultat {
  imprime: boolean;
}

// 11.4, 6.7 : n'imprime réellement (ESC/POS, réseau) que si une imprimante
// a été configurée pour le site — sinon le caissier reste sur l'impression
// navigateur existante (repli côté frontend, jamais un blocage de la vente).
export async function imprimerTicket(db: Db, fournisseur: FournisseurImpression, params: ImprimerTicketParams): Promise<ImprimerTicketResultat> {
  const site = db.select().from(schema.site).where(eq(schema.site.idSite, params.siteId)).get();
  if (!site?.imprimanteHote) return { imprime: false };

  const entreprise = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, site.idEntreprise)).get();
  if (!entreprise) return { imprime: false };

  const donnees = construireTicketEscPos({
    ...params.ticket,
    entreprise: { nom: entreprise.nom, devise: entreprise.devise, mentionsLegales: entreprise.mentionsLegales },
    site: { nom: site.nom, adresse: site.adresse },
  });

  await fournisseur.imprimer(site.imprimanteHote, site.imprimantePort ?? PORT_PAR_DEFAUT, donnees);
  return { imprime: true };
}
