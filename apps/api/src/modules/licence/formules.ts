import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import type { PALIERS_LICENCE } from "./cle-renouvellement.js";

// 10.1 : ce que chaque formule ouvre. Appliqué seulement quand le renouvellement par clé est activé : pendant le pilote (sans clé publique),
// aucune formule ne peut être attribuée à une boutique, la limiter la laisserait sans issue. Rien d'existant n'est supprimé ni masqué : seuls
// les ajouts au-delà de la formule sont refusés, et les commissions déjà dues peuvent toujours se régler.
export interface LimitesFormule {
  boutiques: number;
  personnesConnectees: number;
  apporteurs: boolean;
  exportComptable: boolean;
}

export const LIMITES_FORMULES: Record<(typeof PALIERS_LICENCE)[number], LimitesFormule> = {
  ESSENTIEL: { boutiques: 1, personnesConnectees: 2, apporteurs: false, exportComptable: false },
  PRO: { boutiques: 1, personnesConnectees: Infinity, apporteurs: true, exportComptable: true },
  RESEAU: { boutiques: Infinity, personnesConnectees: Infinity, apporteurs: true, exportComptable: true },
};

export function limitesFormule(palier: string): LimitesFormule {
  return LIMITES_FORMULES[palier as keyof typeof LIMITES_FORMULES] ?? LIMITES_FORMULES.ESSENTIEL;
}

const CONTACT = "Demandez à votre éditeur MboaPilot une clé pour changer de formule.";
const MESSAGE_BOUTIQUES = `Plusieurs boutiques : cette possibilité fait partie de la formule Réseau. ${CONTACT}`;
const MESSAGE_APPORTEURS = `Les apporteurs d'affaires et leurs commissions sont inclus à partir de la formule Pro. ${CONTACT}`;
const MESSAGE_EXPORT_COMPTABLE = `L'export comptable est inclus à partir de la formule Pro. « Exporter mes données » reste disponible dans Administration → Paramètres. ${CONTACT}`;

export function messagePlacesOccupees(maximum: number): string {
  return `Votre formule permet ${maximum} personnes connectées en même temps. Demandez à l'une d'elles de se déconnecter (ou attendez quinze minutes sans activité), ou passez à la formule Pro.`;
}

const objet = (valeur: unknown): Record<string, unknown> => (valeur && typeof valeur === "object" && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : {});
const present = (valeur: unknown) => valeur !== undefined && valeur !== null;

// message de refus si la demande dépasse la formule, null sinon. La route est lue telle que déclarée (et non dans l'adresse reçue).
export function refusFormule(db: Db, limites: LimitesFormule, request: FastifyRequest): string | null {
  const route = request.routeOptions.url ?? "";
  const methode = request.method;
  if (!limites.exportComptable && route.startsWith("/api/v1/export-comptable/")) return MESSAGE_EXPORT_COMPTABLE;
  if (methode !== "POST" && methode !== "PATCH") return null;

  const corps = objet(request.body);
  const params = objet(request.params);

  if (!limites.apporteurs) {
    if (methode === "POST" && route === "/api/v1/apporteurs") return MESSAGE_APPORTEURS;
    if ((route === "/api/v1/utilisateurs" || route === "/api/v1/utilisateurs/:idUser") && corps.role === "APPORTEUR") return MESSAGE_APPORTEURS;
    // rattacher un apporteur : à un nouveau client, à une vente d'abonnement, ou en changeant celui d'un client existant
    if (methode === "POST" && (present(objet(corps.abonne).apporteurId) || present(objet(corps.nouvelAbonne).apporteurId))) return MESSAGE_APPORTEURS;
    if (methode === "POST" && (route === "/api/v1/recrutements" || route === "/api/v1/abonnes") && present(corps.apporteurId)) return MESSAGE_APPORTEURS;
    if (methode === "PATCH" && route === "/api/v1/abonnes/:idAbonne" && present(corps.apporteurId)) {
      const actuel = db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, Number(params.idAbonne))).get();
      // la fiche renvoie l'apporteur déjà en place quand on corrige un autre champ
      if (corps.apporteurId !== actuel?.apporteurId) return MESSAGE_APPORTEURS;
    }
  }

  if (Number.isFinite(limites.boutiques)) {
    const ouvertes = () => db.select().from(schema.site).where(eq(schema.site.actif, 1)).all();
    if (methode === "POST" && route === "/api/v1/sites" && ouvertes().length >= limites.boutiques) return MESSAGE_BOUTIQUES;
    if (methode === "PATCH" && route === "/api/v1/sites/:idSite" && corps.actif === true) {
      const actives = ouvertes();
      if (!actives.some((s) => s.idSite === Number(params.idSite)) && actives.length >= limites.boutiques) return MESSAGE_BOUTIQUES;
    }
  }
  return null;
}
