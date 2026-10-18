import { and, eq, sql } from "drizzle-orm";
import { joursAvantEcheance, LIMITE_RESULTATS_RECHERCHE_ABONNES, normaliserLibelle } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { exigerApporteurActif } from "../apporteurs/apporteur.repository.js";
import { emailFacultatif, telephoneFacultatif, telephoneObligatoire, texteFacultatif, texteObligatoire } from "../../lib/champs-texte.js";

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
  const nom = texteObligatoire(input.nom, "Le nom de l'abonné", 100);
  const prenom = texteObligatoire(input.prenom, "Le prénom de l'abonné", 100);
  const telephone = telephoneObligatoire(input.telephone, "Le téléphone de l'abonné");
  if (input.apporteurId !== undefined && input.apporteurId !== null) exigerApporteurActif(db, input.apporteurId);

  return db
    .insert(schema.abonne)
    .values({
      siteId: input.siteId,
      nom,
      prenom,
      telephone,
      email: emailFacultatif(input.email, "L'adresse e-mail de l'abonné") ?? undefined,
      numeroCni: texteFacultatif(input.numeroCni, "Le numéro de CNI de l'abonné", 30) ?? undefined,
      adresse: texteFacultatif(input.adresse, "L'adresse de l'abonné", 300) ?? undefined,
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
  // facultatifs : absent = inchangé ; null ou texte vide = effacé
  email?: string | null;
  numeroCni?: string | null;
  adresse?: string | null;
  // 6.3, 14.2 : "non modifiable après création sans droit administrateur" —
  // la restriction de rôle est vérifiée côté route (abonnes.routes.ts), pas ici.
  apporteurId?: number | null;
}

// 8.1 : modification de fiche abonné
export function modifierAbonne(db: Db, idAbonne: number, input: ModifierAbonneInput) {
  const existant = trouverAbonne(db, idAbonne);
  if (!existant) throw new Error(`Abonné ${idAbonne} introuvable`);

  // 8.1 : mêmes contrôles qu'à la création (creerAbonne) — une chaîne vide n'est pas "nullish"
  // (?? existant.xxx ne s'applique pas dans ce cas), donc { nom: "" } écraserait silencieusement
  // l'identité réelle du client ; un champ absent reste inchangé, un champ facultatif nul est effacé.
  const nom = input.nom === undefined ? undefined : texteObligatoire(input.nom, "Le nom de l'abonné", 100);
  const prenom = input.prenom === undefined ? undefined : texteObligatoire(input.prenom, "Le prénom de l'abonné", 100);
  const telephone = input.telephone === undefined ? undefined : telephoneObligatoire(input.telephone, "Le téléphone de l'abonné");
  const email = emailFacultatif(input.email, "L'adresse e-mail de l'abonné");
  const numeroCni = texteFacultatif(input.numeroCni, "Le numéro de CNI de l'abonné", 30);
  const adresse = texteFacultatif(input.adresse, "L'adresse de l'abonné", 300);
  // seul un NOUVEAU rattachement est contrôlé : un apporteur désactivé depuis ne doit pas empêcher de corriger
  // le téléphone d'un client qu'il avait recruté (le formulaire renvoie le lien existant tel quel)
  if (typeof input.apporteurId === "number" && input.apporteurId !== existant.apporteurId) exigerApporteurActif(db, input.apporteurId);

  return db
    .update(schema.abonne)
    .set({
      nom: nom ?? existant.nom,
      prenom: prenom ?? existant.prenom,
      telephone: telephone ?? existant.telephone,
      email: email === undefined ? existant.email : email,
      numeroCni: numeroCni === undefined ? existant.numeroCni : numeroCni,
      adresse: adresse === undefined ? existant.adresse : adresse,
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
// une recherche d'une seule lettre renvoyait 40 000 résultats (7,4 Mo à chaque frappe) sur 50 000 clients : la liste
// est bornée, l'interface invite à affiner la recherche quand la limite est atteinte
export const LIMITE_RESULTATS_RECHERCHE = LIMITE_RESULTATS_RECHERCHE_ABONNES;

export function rechercherAbonnes(db: Db, siteId: number, terme: string, limite = LIMITE_RESULTATS_RECHERCHE) {
  const termeNumerique = /^\d+$/.test(terme) ? Number(terme) : null;

  if (termeNumerique !== null) {
    const parId = db
      .select()
      .from(schema.abonne)
      .where(and(eq(schema.abonne.siteId, siteId), eq(schema.abonne.idAbonne, termeNumerique)))
      .all();
    if (parId.length > 0) return parId.slice(0, limite);

    const parAbonnement = db
      .select({ abonne: schema.abonne })
      .from(schema.abonnement)
      .innerJoin(schema.abonne, eq(schema.abonnement.idAbonne, schema.abonne.idAbonne))
      .where(and(eq(schema.abonne.siteId, siteId), eq(schema.abonnement.numeroAbonnement, termeNumerique)))
      .all();
    if (parAbonnement.length > 0) return parAbonnement.map((r) => r.abonne).slice(0, limite);
  }

  // 4.5, 8.2 : même repère que l'import CSV et le transfert de stock — un
  // caissier tape rarement les accents (clavier/téléphone basique), donc la
  // recherche par nom/prénom reste en JS (normalisation NFD, sans équivalent
  // SQLite natif fiable). Le téléphone est comparé sur ses seuls chiffres, hors
  // indicatif pays : les numéros sont saisis avec espaces, tirets ou « +237 ».
  const termeNormalise = normaliserLibelle(terme);
  const termeTelephone = /^[+\d\s().-]+$/.test(terme) ? chiffresTelephone(terme) : "";
  const abonnesSite = db.select().from(schema.abonne).where(eq(schema.abonne.siteId, siteId)).all();
  const trouves: typeof abonnesSite = [];
  for (const a of abonnesSite) {
    const correspond =
      normaliserLibelle(a.nom).includes(termeNormalise) ||
      normaliserLibelle(a.prenom).includes(termeNormalise) ||
      a.telephone.includes(terme) ||
      (termeTelephone !== "" && chiffresTelephone(a.telephone).includes(termeTelephone));
    if (!correspond) continue;
    trouves.push(a);
    if (trouves.length >= limite) break; // inutile de normaliser le reste de la base
  }
  return trouves;
}

const INDICATIF_CAMEROUN = "237";

// chiffres seuls d'un numéro, sans l'indicatif pays quand le numéro est complet
// (« +237 690 11 22 33 » et « 690112233 » désignent le même abonné)
function chiffresTelephone(valeur: string): string {
  const chiffres = valeur.replace(/\D/g, "");
  return chiffres.startsWith(INDICATIF_CAMEROUN) && chiffres.length > 9 ? chiffres.slice(INDICATIF_CAMEROUN.length) : chiffres;
}
