import { normaliserLibelle } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import {
  creerFamille,
  creerFormule,
  creerKit,
  creerOption,
  definirPrixDecodeurKit,
  lierOptionFormule,
  listerFamilles,
  listerFormules,
  listerKits,
  listerOptions,
  modifierFormule,
} from "./catalogue.repository.js";

// Catalogue de départ : les tarifs de l'annexe 14.1 du cahier des charges (« référence rapide pour la recette et la saisie
// initiale du catalogue »), à charger en un clic au lieu de saisir à la main une trentaine de formules, des kits à règle de
// prix et des options compatibles. Ce sont des données, modifiables ensuite dans Administration (8.8) : « mise à jour dans le
// catalogue paramétrable, jamais dans le code ». Ce qui n'a pas été communiqué n'est pas inventé (voir `notes`).

interface FormuleDepart {
  libelle: string;
  prix: number;
  rang: number; // classées par prix croissant : « formule supérieure » (changement de formule) se lit sur ce rang
  dureeCycles?: number; // cycles de 30 jours (4.1) ; toutes les formules du cahier des charges sont en STRICT_30J
  desactivee?: boolean; // créée mais hors vente, tant que son tarif n'est pas renseigné
}

type KitDepart =
  | { libelle: string; reglePrix: "PRIX_FIXE"; prixFixe: number }
  | { libelle: string; reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE"; prixParaboleAccessoires: number; decodeurParFormule: Record<string, number> }
  | { libelle: string; reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL"; prixKitReference: number; formuleReference: string };

interface OptionDepart {
  libelle: string;
  prix: number;
  // formules compatibles, avec un prix de surcharge éventuel ; vide quand le cahier des charges ne le précise pas
  compatibles: { formule: string; prixSurcharge?: number }[];
}

interface FamilleDepart {
  libelle: string;
  formules: FormuleDepart[];
  kits: KitDepart[];
  options: OptionDepart[];
}

interface OperateurDepart {
  cle: string;
  libelle: string;
  familles: FamilleDepart[];
  notes: string[];
}

const RANG_PAR_PRIX = (formules: Omit<FormuleDepart, "rang">[]): FormuleDepart[] =>
  [...formules].sort((a, b) => a.prix - b.prix).map((f, i) => ({ ...f, rang: i + 1 }));

const MOIS_STREAMING = (prixMois: number, prixAn: number): FormuleDepart[] => [
  { libelle: "1 mois", prix: prixMois, rang: 1, dureeCycles: 1 },
  { libelle: "12 mois", prix: prixAn, rang: 2, dureeCycles: 12 },
];

const OPERATEURS: OperateurDepart[] = [
  {
    cle: "canal-plus",
    libelle: "CANAL+",
    familles: [
      {
        libelle: "CANAL+",
        formules: RANG_PAR_PRIX([
          { libelle: "ACCESS", prix: 5000 },
          { libelle: "UNA WELCOME", prix: 8000 },
          { libelle: "EVASION", prix: 10500 },
          { libelle: "ACCESS+", prix: 15000 },
          { libelle: "TOUT CANAL+", prix: 28000 },
        ]),
        kits: [
          // 5.1.1 : décodeur variable selon la formule ; l'annexe ne donne que EVASION et TOUT CANAL+
          { libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", prixParaboleAccessoires: 0, decodeurParFormule: { EVASION: 5000, "TOUT CANAL+": 1000 } },
          { libelle: "KIT CANAL+ Z4", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", prixParaboleAccessoires: 0, decodeurParFormule: { EVASION: 5000, "TOUT CANAL+": 1000 } },
          { libelle: "KIT CANAL+ G11", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", prixParaboleAccessoires: 0, decodeurParFormule: { EVASION: 30000 } },
          // prix « en attente » dans l'annexe : créé sans grille, il affiche « Prix non configuré » à la caisse jusqu'à saisie
          { libelle: "KIT CANAL+ DÉCODEUR OTT", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", prixParaboleAccessoires: 0, decodeurParFormule: {} },
        ],
        options: [
          { libelle: "Option English Plus", prix: 5000, compatibles: [{ formule: "ACCESS" }, { formule: "EVASION" }, { formule: "ACCESS+", prixSurcharge: 2000 }] },
          { libelle: "Option Charme", prix: 7000, compatibles: [] },
          { libelle: "Option CANAL+ Netflix Basic (1 écran)", prix: 3000, compatibles: [] },
          { libelle: "Option CANAL+ Netflix Standard (2 écrans)", prix: 4000, compatibles: [] },
          { libelle: "Option CANAL+ Netflix Premium (4 écrans)", prix: 5000, compatibles: [] },
        ],
      },
    ],
    notes: [
      "Le prix du KIT CANAL+ DÉCODEUR OTT est « en attente » dans le cahier des charges : le kit est créé sans prix et reste non vendable tant que vous ne l'avez pas renseigné.",
      "Les kits GlobalZ, Z4 et G11 ne portent que les prix de décodeur donnés par l'annexe (EVASION, TOUT CANAL+ ; EVASION pour G11) : complétez les autres formules dans Administration.",
      "Les options Charme et Netflix sont créées sans formule compatible (non précisé) : rattachez-les dans Administration.",
      "Les formules sont classées par prix croissant ; ajustez le rang si l'opérateur les ordonne autrement (il sert au changement de formule).",
    ],
  },
  {
    cle: "dstv",
    libelle: "DStv",
    familles: [
      {
        libelle: "DSTV",
        formules: RANG_PAR_PRIX([
          { libelle: "YANGA", prix: 5000 },
          { libelle: "CONFAM", prix: 9000 },
          { libelle: "COMPAQ", prix: 13000 },
          { libelle: "COMPAQ+", prix: 19000 },
          { libelle: "PREMIUM", prix: 28000 },
        ]),
        // 5.5 : 55 000 FCFA sur base COMPAQ, majoré de la différence si la formule choisie est supérieure
        kits: [{ libelle: "KIT DSTV COMPAQ", reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL", prixKitReference: 55000, formuleReference: "COMPAQ" }],
        options: [
          { libelle: "Option French Plus", prix: 13000, compatibles: [] },
          { libelle: "Option French Touch", prix: 6000, compatibles: [] },
          { libelle: "Option Extra View", prix: 4500, compatibles: [] },
        ],
      },
    ],
    notes: ["Les options DStv sont créées sans formule compatible (non précisé) : rattachez-les dans Administration."],
  },
  {
    cle: "startimes",
    libelle: "StarTimes",
    familles: [
      {
        libelle: "StarTimes",
        formules: RANG_PAR_PRIX([
          { libelle: "NOVA", prix: 2500 },
          { libelle: "SMART", prix: 5000 },
          { libelle: "SUPER (EN/FR)", prix: 9000 },
          { libelle: "GLOBAL", prix: 10500 },
        ]),
        kits: [{ libelle: "KIT STARTIMES", reglePrix: "PRIX_FIXE", prixFixe: 18000 }],
        options: [],
      },
    ],
    notes: ["Le prix du kit inclut sa première formule (le ticket affiche la formule, puis le matériel pour le reste) : le client paie le prix du kit, pas le prix du kit plus la formule."],
  },
  {
    cle: "24h-sport",
    libelle: "24H Sport",
    familles: [
      {
        libelle: "24H Sport",
        // 3 mois = 3 cycles de 30 jours : validité de 90 jours (4.1)
        formules: [{ libelle: "FULL 24H SPORT 3 MOIS", prix: 15000, rang: 1, dureeCycles: 3 }],
        kits: [{ libelle: "KIT 24H SPORT", reglePrix: "PRIX_FIXE", prixFixe: 30000 }],
        options: [],
      },
    ],
    notes: ["Le prix du kit inclut sa première formule (le ticket affiche la formule, puis le matériel pour le reste) : le client paie le prix du kit, pas le prix du kit plus la formule."],
  },
  {
    cle: "moreplex",
    libelle: "Moreplex",
    familles: [
      {
        libelle: "Moreplex",
        formules: [{ libelle: "FULL MOREPLEX", prix: 5000, rang: 1 }],
        kits: [{ libelle: "KIT MOREPLEX", reglePrix: "PRIX_FIXE", prixFixe: 30000 }],
        options: [],
      },
    ],
    notes: ["Le prix du kit inclut sa première formule (le ticket affiche la formule, puis le matériel pour le reste) : le client paie le prix du kit, pas le prix du kit plus la formule."],
  },
  {
    cle: "streaming",
    libelle: "Streaming et IPTV",
    familles: [
      { libelle: "Netflix", formules: MOIS_STREAMING(3500, 26000), kits: [], options: [] },
      { libelle: "Prime Vidéo", formules: MOIS_STREAMING(3500, 26000), kits: [], options: [] },
      { libelle: "Crunchyroll", formules: MOIS_STREAMING(3500, 26000), kits: [], options: [] },
      { libelle: "IPTV", formules: MOIS_STREAMING(5000, 40000), kits: [], options: [] },
      // aucun tarif communiqué : la fiche existe (5.9) mais hors vente, pour ne pas se vendre gratuitement avant d'être renseignée
      { libelle: "Disney+", formules: MOIS_STREAMING(0, 0).map((f) => ({ ...f, desactivee: true })), kits: [], options: [] },
    ],
    notes: [
      "Aucun tarif Disney+ n'a été communiqué : ses deux formules sont créées désactivées, à 0 FCFA ; renseignez le tarif puis activez-les dans Administration.",
      "Après avoir créé un compte partagé (Administration, Comptes streaming), le recrutement peut l'affecter à un écran.",
    ],
  },
];

export interface OperateurDepartResume {
  cle: string;
  libelle: string;
  nombreFormules: number;
  nombreKits: number;
  nombreOptions: number;
  notes: string[];
}

export function listerOperateursDepart(): OperateurDepartResume[] {
  return OPERATEURS.map((o) => ({
    cle: o.cle,
    libelle: o.libelle,
    nombreFormules: o.familles.reduce((n, f) => n + f.formules.length, 0),
    nombreKits: o.familles.reduce((n, f) => n + f.kits.length, 0),
    nombreOptions: o.familles.reduce((n, f) => n + f.options.length, 0),
    notes: o.notes,
  }));
}

export interface ResultatChargementDepart {
  crees: { familles: number; formules: number; kits: number; options: number; liaisons: number };
  // éléments déjà présents (même libellé), laissés tels quels : la saisie de la boutique prime toujours
  dejaPresents: number;
  notes: string[];
}

// Charge les opérateurs choisis, tout ou rien. Idempotent : un élément qui existe déjà (même libellé, sans tenir compte de la
// casse ni des espaces) n'est ni recréé ni modifié, ses sous-éléments (grille de décodeurs, compatibilités d'une option) non plus.
export function chargerCatalogueDepart(db: Db, cles: string[], acteurId: number | null = null): ResultatChargementDepart {
  if (!Array.isArray(cles) || cles.length === 0) throw new Error("Choisissez au moins un opérateur à charger");
  const choisis = cles.map((cle) => {
    const operateur = OPERATEURS.find((o) => o.cle === cle);
    if (!operateur) throw new Error(`Opérateur inconnu : ${String(cle)}`);
    return operateur;
  });

  return db.transaction(() => {
    const resultat: ResultatChargementDepart = { crees: { familles: 0, formules: 0, kits: 0, options: 0, liaisons: 0 }, dejaPresents: 0, notes: [] };
    for (const operateur of choisis) {
      for (const donnees of operateur.familles) chargerFamille(db, donnees, acteurId, resultat);
      resultat.notes.push(...operateur.notes);
    }
    return resultat;
  });
}

function chargerFamille(db: Db, donnees: FamilleDepart, acteurId: number | null, resultat: ResultatChargementDepart) {
  const existante = listerFamilles(db).find((f) => normaliserLibelle(f.libelle) === normaliserLibelle(donnees.libelle));
  if (existante) resultat.dejaPresents++;
  else resultat.crees.familles++;
  const famille = existante ?? creerFamille(db, { libelle: donnees.libelle });

  const formulesExistantes = listerFormules(db, famille.idFamille);
  const idFormuleParLibelle = new Map<string, number>();
  for (const f of formulesExistantes) idFormuleParLibelle.set(normaliserLibelle(f.libelle), f.idFormule);

  for (const f of donnees.formules) {
    const cle = normaliserLibelle(f.libelle);
    if (idFormuleParLibelle.has(cle)) {
      resultat.dejaPresents++;
      continue;
    }
    const creee = creerFormule(db, { idFamille: famille.idFamille, libelle: f.libelle, prix: f.prix, rang: f.rang, modeDuree: "STRICT_30J", dureeCycles: f.dureeCycles ?? 1 }, acteurId);
    if (f.desactivee) modifierFormule(db, creee.idFormule, { actif: false }, acteurId);
    idFormuleParLibelle.set(cle, creee.idFormule);
    resultat.crees.formules++;
  }

  const kitsExistants = new Set(listerKits(db, famille.idFamille).map((k) => normaliserLibelle(k.libelle)));
  for (const k of donnees.kits) {
    if (kitsExistants.has(normaliserLibelle(k.libelle))) {
      resultat.dejaPresents++;
      continue;
    }
    const idFormule = (libelle: string) => idFormuleParLibelle.get(normaliserLibelle(libelle));
    const kitCree = creerKit(
      db,
      k.reglePrix === "PRIX_FIXE"
        ? { idFamille: famille.idFamille, libelle: k.libelle, reglePrix: k.reglePrix, prixFixe: k.prixFixe }
        : k.reglePrix === "PRIX_KIT_FIXE_PAR_DIFFERENTIEL"
          ? { idFamille: famille.idFamille, libelle: k.libelle, reglePrix: k.reglePrix, prixKitReference: k.prixKitReference, idFormuleReference: idFormule(k.formuleReference) }
          : { idFamille: famille.idFamille, libelle: k.libelle, reglePrix: k.reglePrix, prixParaboleAccessoires: k.prixParaboleAccessoires },
      acteurId,
    );
    if (k.reglePrix === "PRIX_DECODEUR_VARIABLE_SELON_FORMULE") {
      for (const [formule, prixDecodeur] of Object.entries(k.decodeurParFormule)) {
        const id = idFormule(formule);
        if (id !== undefined) definirPrixDecodeurKit(db, { idKit: kitCree.idKit, idFormule: id, prixDecodeur }, acteurId);
      }
    }
    resultat.crees.kits++;
  }

  const optionsExistantes = new Set(listerOptions(db).map((o) => normaliserLibelle(o.libelle)));
  for (const o of donnees.options) {
    if (optionsExistantes.has(normaliserLibelle(o.libelle))) {
      resultat.dejaPresents++;
      continue;
    }
    const optionCree = creerOption(db, { libelle: o.libelle, prix: o.prix }, acteurId);
    resultat.crees.options++;
    for (const c of o.compatibles) {
      const id = idFormuleParLibelle.get(normaliserLibelle(c.formule));
      if (id === undefined) continue;
      lierOptionFormule(db, { idFormule: id, idOption: optionCree.idOption, prixSurcharge: c.prixSurcharge }, acteurId);
      resultat.crees.liaisons++;
    }
  }
}
