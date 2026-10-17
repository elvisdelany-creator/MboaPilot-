import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { construireTicketEscPos, type TicketEscPosInput } from "./escpos.js";
import type { FournisseurImpression } from "./fournisseur.js";
import { texteObligatoire } from "../../lib/champs-texte.js";
import { verifierEntier } from "../../lib/validation.js";

const PORT_PAR_DEFAUT = 9100; // "RAW/JetDirect" — port standard des imprimantes réseau

export interface ImprimerTicketParams {
  siteId: number;
  // idFacture : la facture dont on imprime le ticket (6.4, règle 2 : jamais d'impression d'un BROUILLON)
  ticket: Omit<TicketEscPosInput, "entreprise" | "site"> & { idFacture: number };
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

// 6.4 : « une facture BROUILLON ne peut jamais être imprimée ni transmise au client — contrainte système ».
// Le ticket doit se rattacher à une facture VALIDEE du site de l'appelant (un encaissement, même partiel).
function verifierFactureImprimable(db: Db, siteId: number, idFacture: unknown): void {
  verifierEntier(idFacture, "Le numéro de facture du ticket", { min: 1, requis: true, nullable: false });
  const facture = db
    .select()
    .from(schema.facture)
    .where(and(eq(schema.facture.idFacture, idFacture as number), eq(schema.facture.siteId, siteId)))
    .get();
  if (!facture) throw new Error(`Facture ${idFacture} introuvable`);
  if (facture.statut !== "VALIDEE") {
    throw new Error(`La facture ${idFacture} est un brouillon : elle ne peut pas être imprimée avant un premier encaissement`);
  }
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
  verifierFactureImprimable(db, params.siteId, params.ticket.idFacture);

  const donnees = construireTicketEscPos({
    ...params.ticket,
    entreprise: { nom: entreprise.nom, devise: entreprise.devise, mentionsLegales: entreprise.mentionsLegales },
    site: { nom: site.nom, adresse: site.adresse },
  });

  await fournisseur.imprimer(site.imprimanteHote, site.imprimantePort ?? PORT_PAR_DEFAUT, donnees);
  return { imprime: true };
}
