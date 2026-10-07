import { and, eq, sql } from "drizzle-orm";
import { joursAvantEcheance, normaliserLibelle } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";

export interface AbonneInput {
  siteId: number;
  nom: string;
  prenom: string;
  telephone: string;
  email?: string;
  numeroCni?: string;
  adresse?: string;
  apporteurId?: number;
}

export function creerAbonne(db: Db, input: AbonneInput) {
  if (!input.nom.trim()) throw new Error("Le nom de l'abonné est obligatoire");
  if (!input.prenom.trim()) throw new Error("Le prénom de l'abonné est obligatoire");
  if (!input.telephone.trim()) throw new Error("Le téléphone de l'abonné est obligatoire");

  return db
    .insert(schema.abonne)
    .values({
      siteId: input.siteId,
      nom: input.nom,
      prenom: input.prenom,
      telephone: input.telephone,
      email: input.email,
      numeroCni: input.numeroCni,
      adresse: input.adresse,
      apporteurId: input.apporteurId,
    })
    .returning()
    .get();
}

export function trouverAbonne(db: Db, idAbonne: number) {
  return db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, idAbonne)).get();
}

export interface ModifierAbonneInput {
  nom?: string;
  prenom?: string;
  telephone?: string;
  email?: string;
  numeroCni?: string;
  adresse?: string;
  // 6.3, 14.2 : "non modifiable après création sans droit administrateur" —
  // la restriction de rôle est vérifiée côté route (abonnes.routes.ts), pas ici.
  apporteurId?: number | null;
}

// 8.1 : modification de fiche abonné
export function modifierAbonne(db: Db, idAbonne: number, input: ModifierAbonneInput) {
  const existant = trouverAbonne(db, idAbonne);
  if (!existant) throw new Error(`Abonné ${idAbonne} introuvable`);

  // 8.1 : même garde-fou qu'à la création (creerAbonne) — une chaîne vide
  // n'est pas "nullish" (?? existant.xxx ne s'applique pas dans ce cas),
  // donc { nom: "" } écraserait silencieusement l'identité réelle du client.
  if (input.nom !== undefined && !input.nom.trim()) throw new Error("Le nom de l'abonné est obligatoire");
  if (input.prenom !== undefined && !input.prenom.trim()) throw new Error("Le prénom de l'abonné est obligatoire");
  if (input.telephone !== undefined && !input.telephone.trim()) throw new Error("Le téléphone de l'abonné est obligatoire");

  return db
    .update(schema.abonne)
    .set({
      nom: input.nom ?? existant.nom,
      prenom: input.prenom ?? existant.prenom,
      telephone: input.telephone ?? existant.telephone,
      email: input.email ?? existant.email,
      numeroCni: input.numeroCni ?? existant.numeroCni,
      adresse: input.adresse ?? existant.adresse,
      ...(input.apporteurId !== undefined && { apporteurId: input.apporteurId }),
    })
    .where(eq(schema.abonne.idAbonne, idAbonne))
    .returning()
    .get();
}

const PLACEHOLDER_NOM_ANONYMISE = "Anonymisé";

export interface AbonneEligibleAnonymisation {
  abonne: typeof schema.abonne.$inferSelect;
  derniereActivite: string; // date_fin du plus récent abonnement, ou date de création si aucun
}

// 11.3 : "durée de conservation définie et paramétrable, avec archivage ou
// anonymisation au-delà" — abonnés sans abonnement ACTIF, dont la dernière
// activité (date_fin du plus récent abonnement, ou création de la fiche si
// aucun abonnement) dépasse la durée de conservation configurée
// (entreprise.repository.ts). Les fiches déjà anonymisées sont ignorées
// pour ne pas les rejournaliser à chaque exécution du job quotidien.
export function listerAbonnesEligiblesAnonymisationAutomatique(
  db: Db,
  aujourdHui: string,
  dureeConservationJours: number
): AbonneEligibleAnonymisation[] {
  const abonnes = db.select().from(schema.abonne).all().filter((a) => a.nom !== PLACEHOLDER_NOM_ANONYMISE);

  // 11.1 : une seule agrégation pour tous les abonnés (et non une requête par
  // abonné) — le job quotidien bloquait l'API ~8 s à 50 000 abonnés
  const syntheseParAbonne = new Map(
    db
      .select({
        idAbonne: schema.abonnement.idAbonne,
        derniereFin: sql<string>`max(${schema.abonnement.dateFin})`,
        nombreActifs: sql<number>`sum(${schema.abonnement.statut} = 'ACTIF')`,
      })
      .from(schema.abonnement)
      .groupBy(schema.abonnement.idAbonne)
      .all()
      .map((r) => [r.idAbonne, r]),
  );

  return abonnes
    .map((abonne) => {
      const synthese = syntheseParAbonne.get(abonne.idAbonne);
      const aUnAbonnementActif = (synthese?.nombreActifs ?? 0) > 0;
      const derniereActivite = synthese ? synthese.derniereFin : abonne.dateCreation.slice(0, 10);
      return { abonne, aUnAbonnementActif, derniereActivite };
    })
    .filter((a) => !a.aUnAbonnementActif)
    .filter((a) => -joursAvantEcheance(a.derniereActivite, aujourdHui) >= dureeConservationJours)
    .map(({ abonne, derniereActivite }) => ({ abonne, derniereActivite }));
}

// 4.5 : recherche unifiée par numéro d'abonné, numéro d'abonnement en cours,
// nom/prénom ou téléphone — résolution unique vers la fiche ABONNE.
export function rechercherAbonnes(db: Db, siteId: number, terme: string) {
  const termeNumerique = /^\d+$/.test(terme) ? Number(terme) : null;

  if (termeNumerique !== null) {
    const parId = db
      .select()
      .from(schema.abonne)
      .where(and(eq(schema.abonne.siteId, siteId), eq(schema.abonne.idAbonne, termeNumerique)))
      .all();
    if (parId.length > 0) return parId;

    const parAbonnement = db
      .select({ abonne: schema.abonne })
      .from(schema.abonnement)
      .innerJoin(schema.abonne, eq(schema.abonnement.idAbonne, schema.abonne.idAbonne))
      .where(and(eq(schema.abonne.siteId, siteId), eq(schema.abonnement.numeroAbonnement, termeNumerique)))
      .all();
    if (parAbonnement.length > 0) return parAbonnement.map((r) => r.abonne);
  }

  // 4.5, 8.2 : même repère que l'import CSV et le transfert de stock — un
  // caissier tape rarement les accents (clavier/téléphone basique), donc la
  // recherche par nom/prénom reste en JS (normalisation NFD, sans équivalent
  // SQLite natif fiable). Le téléphone est comparé sur ses seuls chiffres, hors
  // indicatif pays : les numéros sont saisis avec espaces, tirets ou « +237 ».
  const termeNormalise = normaliserLibelle(terme);
  const termeTelephone = /^[+\d\s().-]+$/.test(terme) ? chiffresTelephone(terme) : "";
  const abonnesSite = db.select().from(schema.abonne).where(eq(schema.abonne.siteId, siteId)).all();
  return abonnesSite.filter(
    (a) =>
      normaliserLibelle(a.nom).includes(termeNormalise) ||
      normaliserLibelle(a.prenom).includes(termeNormalise) ||
      a.telephone.includes(terme) ||
      (termeTelephone !== "" && chiffresTelephone(a.telephone).includes(termeTelephone))
  );
}

const INDICATIF_CAMEROUN = "237";

// chiffres seuls d'un numéro, sans l'indicatif pays quand le numéro est complet
// (« +237 690 11 22 33 » et « 690112233 » désignent le même abonné)
function chiffresTelephone(valeur: string): string {
  const chiffres = valeur.replace(/\D/g, "");
  return chiffres.startsWith(INDICATIF_CAMEROUN) && chiffres.length > 9 ? chiffres.slice(INDICATIF_CAMEROUN.length) : chiffres;
}
