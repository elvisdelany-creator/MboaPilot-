import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { construireTicketEscPos, type TicketEscPosInput } from "./escpos.js";
import type { FournisseurImpression } from "./fournisseur.js";
import { texteObligatoire } from "../../lib/champs-texte.js";
import { verifierEntier } from "../../lib/validation.js";

const PORT_PAR_DEFAUT = 9100; // "RAW/JetDirect" — port standard des imprimantes réseau

export interface ImprimerTicketParams {
  siteId: number;
  ticket: Omit<TicketEscPosInput, "entreprise" | "site">;
}

export interface ImprimerTicketResultat {
  imprime: boolean;
}

const MODES_PAIEMENT_TICKET = ["CASH", "CHEQUE", "VIREMENT", "MOBILE_MONEY"];
const LIGNES_MAX = 100;
const MONTANT_MAX = 1_000_000_000;

// le contenu du ticket vient du client : une date illisible, un libellé de 100 000 caractères ou un
// total « abc » finissaient sur le papier (ou faisaient échouer l'impression avec un message technique).
// Les montants négatifs restent permis (ticket d'avoir).
function verifierTicket(ticket: unknown): void {
  if (typeof ticket !== "object" || ticket === null) throw new Error("Le ticket à imprimer est vide");
  const t = ticket as Record<string, unknown>;

  texteObligatoire(t.operation, "L'opération du ticket", 100);
  verifierEntier(t.numeroAbonnement, "Le numéro d'abonnement du ticket", { min: 1, nullable: true });

  if (!Array.isArray(t.lignes)) throw new Error("Les lignes du ticket sont obligatoires");
  if (t.lignes.length > LIGNES_MAX) throw new Error(`Un ticket ne peut pas comporter plus de ${LIGNES_MAX} lignes`);
  for (const ligne of t.lignes as Record<string, unknown>[]) {
    texteObligatoire(ligne?.libelle, "Le libellé d'une ligne du ticket", 200);
    verifierEntier(ligne.montant, "Le montant d'une ligne du ticket", { min: -MONTANT_MAX, max: MONTANT_MAX, requis: true, nullable: false });
  }

  verifierEntier(t.total, "Le total du ticket", { min: -MONTANT_MAX, max: MONTANT_MAX, requis: true, nullable: false });
  verifierEntier(t.montantTaxe, "La taxe du ticket", { min: -MONTANT_MAX, max: MONTANT_MAX, requis: true, nullable: false });
  verifierEntier(t.montantEncaisse, "Le montant encaissé du ticket", { min: -MONTANT_MAX, max: MONTANT_MAX, requis: true, nullable: false });

  if (typeof t.modePaiement !== "string" || !MODES_PAIEMENT_TICKET.includes(t.modePaiement)) {
    throw new Error(`Le mode de paiement du ticket est inconnu — attendu : ${MODES_PAIEMENT_TICKET.join(", ")}`);
  }
  if (typeof t.dateHeure !== "string" || Number.isNaN(new Date(t.dateHeure).getTime())) throw new Error("La date du ticket est invalide");
}

// 11.4, 6.7 : n'imprime réellement (ESC/POS, réseau) que si une imprimante
// a été configurée pour le site — sinon le caissier reste sur l'impression
// navigateur existante (repli côté frontend, jamais un blocage de la vente).
export async function imprimerTicket(db: Db, fournisseur: FournisseurImpression, params: ImprimerTicketParams): Promise<ImprimerTicketResultat> {
  const site = db.select().from(schema.site).where(eq(schema.site.idSite, params.siteId)).get();
  if (!site?.imprimanteHote) return { imprime: false };

  const entreprise = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, site.idEntreprise)).get();
  if (!entreprise) return { imprime: false };

  verifierTicket(params.ticket);

  const donnees = construireTicketEscPos({
    ...params.ticket,
    entreprise: { nom: entreprise.nom, devise: entreprise.devise, mentionsLegales: entreprise.mentionsLegales },
    site: { nom: site.nom, adresse: site.adresse },
  });

  await fournisseur.imprimer(site.imprimanteHote, site.imprimantePort ?? PORT_PAR_DEFAUT, donnees);
  return { imprime: true };
}
