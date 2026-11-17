# États de gestion : le socle commun et l'état des ventes — plan de travail

> **Pour les agents d'exécution :** compétence requise : `superpowers:subagent-driven-development` (recommandée) ou `superpowers:executing-plans`, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** un écran « États » où le gérant obtient l'état des ventes d'une période, à l'écran, imprimé en A4, en fichier PDF et en CSV.

**Architecture :** le serveur construit une structure d'état neutre (`EtatImprimable`) ; l'écran, le CSV et le PDF en sont trois rendus. Le calcul du journal des ventes est extrait de l'export comptable pour être partagé. La spécification de référence est `docs/superpowers/specs/2026-11-17-etat-des-ventes-design.md`.

**Pile technique :** TypeScript, Fastify 5, Drizzle + better-sqlite3, vitest (API et code partagé), React 19 + Vite + Tailwind v4 (interface), `pdfkit` 0.20.2 (nouveau).

## Contraintes globales

Valables pour chaque tâche (recopiées de la spécification).

- **Droits :** Administrateur, Gérant, Comptable, c'est-à-dire la garde `pilotage` de `apps/api/src/app.ts`. Caissier, Technicien SAV, Apporteur : 403. Sans compte : 401.
- **Boutique :** celle de la session (`request.user.siteId`). Un paramètre `siteId` dans l'adresse est ignoré.
- **Période :** validée par `verifierPeriodeExport` (dates réelles AAAA-MM-JJ, fin ≥ début, 366 jours au plus). Jours de Douala. Messages d'erreur en français (400).
- **Calcul :** montants TTC, TVA figée sur la facture (HT = TTC − TVA), avoirs en négatif sur leur propre date, ventes en attente (non `VALIDEE`) exclues. Encaissements regroupés par date de paiement ; remboursements en négatif.
- **Volume :** le détail est limité à 5 000 factures à l'écran, en PDF et dans le JSON, avec l'avertissement exact « Détail limité aux 5 000 premières factures : réduisez la période ou utilisez le CSV. » ; le CSV n'est pas limité.
- **CSV :** séparateur `;`, mêmes protections contre les formules de tableur que `construireCsv`.
- **PDF :** A4 portrait, `pdfkit`, police standard Helvetica ; les caractères hors jeu Windows-1252 (notamment l'espace insécable fine) sont remplacés avant l'écriture.
- **Noms de fichiers :** `etat-des-ventes-AAAA-MM-JJ-au-AAAA-MM-JJ.pdf` et `.csv`.
- **Aucune migration** (lecture seule). Aucune donnée n'est écrite.
- **Interface :** en français, pas de Inter / DM Sans / Geist, pas de dégradé violet vers bleu, pas de cartes imbriquées, pas de texte gris sur fond coloré, respect de `prefers-reduced-motion` (aucune animation dans ce chantier). Le détecteur Impeccable doit renvoyer `[]`.
- **Protocole git du dépôt :** **ne rien commiter sans l'ordre « Commite tout ça »**, ne rien pousser sans « Push it » (et une suite API complète fraîche juste avant). Les étapes « Mise de côté » de chaque tâche ne font que lister les fichiers et préparer le message : elles n'exécutent aucun `git commit`. Jamais `git add -A`. Les messages de commit se terminent par `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Fins de ligne :** la plupart des fichiers du dépôt sont en CRLF. Édite avec l'outil `Edit` (qui conserve le format) ou, dans un script, normalise `\r\n` en `\n` puis restaure.
- **Séquences Unicode :** certains outils d'écriture convertissent les séquences `\uXXXX` (par exemple `\u202f`, `\u00a0`, `\uFEFF`) en vrais caractères, invisibles à la relecture. Dans le code de ce plan, elles désignent des espaces insécables, le signe moins typographique et le repère d'octet UTF-8 : après avoir écrit un fichier qui en contient, vérifier avec `grep` qu'elles y sont restées sous forme d'échappements (sinon les ré-écrire, par exemple en construisant la barre oblique inverse par programme).
- **Commandes :** typage de l'interface : `npx tsc --noEmit -p tsconfig.app.json` dans `apps/web` (jamais `tsc -p .`). API : `npx tsc --noEmit -p .` dans `apps/api`. Les gros scripts shell se rédigent avec l'outil `Write` dans un fichier, pas en heredoc.

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `packages/shared/src/etat.ts` (nouveau) | Modèle `EtatImprimable`, formatage, `etatVersCsv`, `nomFichierEtat` |
| `packages/shared/src/etat.test.ts` (nouveau) | Tests de ce modèle |
| `packages/shared/src/periodes-raccourcis.ts` (nouveau) + test | Raccourcis de période (aujourd'hui, hier, semaine, mois, mois dernier) |
| `packages/shared/src/acces-vues.ts` + test (modifiés) | Nouvelle vue `etats` |
| `packages/shared/src/index.ts` (modifié) | Exports |
| `apps/api/src/modules/export-comptable/export-comptable.service.ts` (modifié) | Extraction de `listerJournalVentes` |
| `apps/api/src/modules/export-comptable/export-comptable-journal.test.ts` (nouveau) | Tests de l'extraction |
| `apps/api/src/modules/tableau-bord/tableau-bord.service.ts` (modifié) | `creerResolveurFamilleLigne` exporté |
| `apps/api/src/test-utils/fixture-etat-ventes.ts` (nouveau) | Jeu de données partagé des tests d'états |
| `apps/api/src/modules/etats/etat-ventes.service.ts` (nouveau) + test | Constructeur de l'état des ventes |
| `apps/api/src/modules/etats/etat-pdf.ts` (nouveau) + test | Rendu PDF |
| `apps/api/src/modules/etats/etats.routes.ts` (nouveau) + test | Routes JSON / CSV / PDF |
| `apps/api/src/app.ts` (modifié) | Enregistrement des routes |
| `apps/api/package.json`, `package-lock.json` (modifiés) | Dépendance `pdfkit` |
| `apps/web/src/lib/api.ts` (modifié) | Appels `chargerEtatVentes`, `telechargerEtatVentes` |
| `apps/web/src/components/etats/EtatImprime.tsx` (nouveau) | Rendu générique d'un état (écran et impression) |
| `apps/web/src/components/etats/EtatsPage.tsx` (nouveau) | Écran « États » |
| `apps/web/src/components/layout/AppHeader.tsx`, `apps/web/src/App.tsx` (modifiés) | Navigation et routage |
| `docs/guide-boutique.md`, `docs/exploitation.md`, spécification (modifiés) | Documentation |

---

### Tâche 1 : le modèle d'un état, le CSV et le nom de fichier (code partagé)

**Fichiers :**
- Créer : `packages/shared/src/etat.ts`
- Créer : `packages/shared/src/etat.test.ts`
- Modifier : `packages/shared/src/index.ts`

**Interfaces :**
- Produit (utilisé par toutes les tâches suivantes) : les types `TypeColonneEtat`, `ColonneEtat`, `SectionEtat`, `EtatImprimable` ; `formaterValeurEtat(valeur: string | number, type: TypeColonneEtat): string` ; `libellePeriodeEtat(periode: { du: string; au: string }): string` ; `dateHeureDouala(instantIso: string): string` ; `etatVersCsv(etat: EtatImprimable): string` ; `nomFichierEtat(etat: EtatImprimable, extension: "pdf" | "csv"): string`.
- Écart assumé avec la spécification §5.1 : `ColonneEtat` gagne un champ optionnel `poids?: number` (largeur relative d'une colonne de texte dans le PDF, 1 par défaut). La tâche 9 met la spécification à jour.

- [ ] **Étape 1 : écrire les tests (ils échouent)**

Créer `packages/shared/src/etat.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { dateHeureDouala, etatVersCsv, formaterValeurEtat, libellePeriodeEtat, nomFichierEtat, type EtatImprimable } from "./etat.js";

// Intl.NumberFormat("fr-FR") sépare les milliers par une espace insécable fine : les tests la ramènent à une espace simple
const normaliser = (texte: string) => texte.replace(/[\u00a0\u202f]/g, " ");

function etatExemple(surcharges: Partial<EtatImprimable> = {}): EtatImprimable {
  return {
    identifiant: "etat-des-ventes",
    titre: "État des ventes",
    periode: { du: "2026-11-01", au: "2026-11-17" },
    entete: { nomBoutique: "Boutique Démo", lignesContact: ["Tél : 677 00 00 00"] },
    genereLe: "2026-11-17T14:21:00.000Z",
    sections: [
      {
        titre: "Par jour",
        colonnes: [
          { cle: "jour", libelle: "Jour", type: "date", alignement: "gauche" },
          { cle: "ttc", libelle: "Total TTC", type: "fcfa", alignement: "droite" },
        ],
        lignes: [
          ["2026-11-16", 12500],
          ["2026-11-17", 3000],
        ],
        totaux: ["Total", 15500],
      },
      {
        titre: "Par famille",
        colonnes: [
          { cle: "famille", libelle: "Famille", type: "texte", alignement: "gauche" },
          { cle: "montant", libelle: "Montant", type: "fcfa", alignement: "droite" },
        ],
        lignes: [],
        messageVide: "Aucune vente sur cette période",
      },
    ],
    avertissements: [],
    ...surcharges,
  };
}

describe("formaterValeurEtat", () => {
  it("regroupe les milliers des entiers et des montants, négatifs compris", () => {
    expect(normaliser(formaterValeurEtat(12500, "fcfa"))).toBe("12 500");
    expect(normaliser(formaterValeurEtat(1234567, "entier"))).toBe("1 234 567");
    expect(normaliser(formaterValeurEtat(-2500, "fcfa"))).toBe("-2 500");
    expect(formaterValeurEtat(0, "fcfa")).toBe("0");
  });

  it("n'emploie jamais le vrai signe moins (U+2212), absent du jeu de caractères du PDF", () => {
    expect(formaterValeurEtat(-2500, "fcfa")).not.toContain("\u2212");
  });

  it("met une date AAAA-MM-JJ en JJ/MM/AAAA et laisse tout autre texte tel quel", () => {
    expect(formaterValeurEtat("2026-11-17", "date")).toBe("17/11/2026");
    expect(formaterValeurEtat("Total", "date")).toBe("Total");
  });

  it("laisse un texte tel quel, et ne touche pas à un texte placé dans une colonne de nombres (ligne de totaux)", () => {
    expect(formaterValeurEtat("Marie Ngo", "texte")).toBe("Marie Ngo");
    expect(formaterValeurEtat("Total", "fcfa")).toBe("Total");
    expect(formaterValeurEtat("", "entier")).toBe("");
    expect(formaterValeurEtat(5, "texte")).toBe("5");
  });
});

describe("libellePeriodeEtat et dateHeureDouala", () => {
  it("dit « du … au … » pour une période, « le … » pour un seul jour", () => {
    expect(libellePeriodeEtat({ du: "2026-11-01", au: "2026-11-17" })).toBe("du 01/11/2026 au 17/11/2026");
    expect(libellePeriodeEtat({ du: "2026-11-17", au: "2026-11-17" })).toBe("le 17/11/2026");
  });

  it("donne la date et l'heure de Douala (UTC+1), y compris au passage de minuit", () => {
    expect(dateHeureDouala("2026-11-17T14:21:00.000Z")).toBe("17/11/2026 15:21");
    expect(dateHeureDouala("2026-11-16T23:30:00.000Z")).toBe("17/11/2026 00:30");
  });
});

describe("nomFichierEtat", () => {
  it("compose le nom à partir de l'identifiant de l'état et de la période", () => {
    expect(nomFichierEtat(etatExemple(), "pdf")).toBe("etat-des-ventes-2026-11-01-au-2026-11-17.pdf");
    expect(nomFichierEtat(etatExemple(), "csv")).toBe("etat-des-ventes-2026-11-01-au-2026-11-17.csv");
  });
});

describe("etatVersCsv", () => {
  it("écrit le titre, la période, la boutique, la date de génération, puis chaque section séparée d'une ligne vide, avec ses totaux", () => {
    expect(etatVersCsv(etatExemple()).split("\r\n")).toEqual([
      "État des ventes",
      "Période;du 01/11/2026 au 17/11/2026",
      "Boutique;Boutique Démo",
      "Généré le;17/11/2026 15:21",
      "",
      "Par jour",
      "Jour;Total TTC",
      "16/11/2026;12500",
      "17/11/2026;3000",
      "Total;15500",
      "",
      "Par famille",
      "Famille;Montant",
      "Aucune vente sur cette période",
    ]);
  });

  it("écrit les montants en nombres bruts (pas d'espaces dans les milliers : Excel les lit comme des nombres)", () => {
    expect(etatVersCsv(etatExemple())).toContain("16/11/2026;12500");
  });

  it("reprend les avertissements sous l'en-tête", () => {
    const csv = etatVersCsv(etatExemple({ avertissements: ["Détail limité aux 2 premières factures : réduisez la période ou utilisez le CSV."] })).split("\r\n");

    expect(csv[4]).toBe("Avertissement;Détail limité aux 2 premières factures : réduisez la période ou utilisez le CSV.");
  });

  it("neutralise une cellule qui commence par = + - @ (formule de tableur) et protège les « ; » du texte", () => {
    const etat = etatExemple({
      sections: [
        {
          titre: "Clients",
          colonnes: [{ cle: "client", libelle: "Client", type: "texte", alignement: "gauche" }],
          lignes: [["=HYPERLINK(\"http://pirate.example\")"], ["Ngo; Marie"]],
        },
      ],
    });

    const lignes = etatVersCsv(etat).split("\r\n");

    expect(lignes).toContain("\"'=HYPERLINK(\"\"http://pirate.example\"\")\"");
    expect(lignes).toContain("\"Ngo; Marie\"");
  });

  it("une section sans ligne ni message écrit « Aucune donnée »", () => {
    const etat = etatExemple({ sections: [{ titre: "Vide", colonnes: [{ cle: "a", libelle: "A", type: "texte", alignement: "gauche" }], lignes: [] }] });

    expect(etatVersCsv(etat)).toContain("Aucune donnée");
  });
});
```

- [ ] **Étape 2 : constater l'échec**

Run : `cd packages/shared && npx vitest run src/etat.test.ts`
Attendu : échec, « Failed to resolve import "./etat.js" ».

- [ ] **Étape 3 : écrire l'implémentation**

Créer `packages/shared/src/etat.ts` :

```ts
import { construireCsv } from "./csv.js";
import { heureDouala, jourDouala } from "./jour-douala.js";

// États de gestion imprimables (état des ventes, de caisse, du stock…). Le serveur construit un `EtatImprimable` ; l'écran, le CSV et le PDF en sont
// trois rendus : les chiffres sont calculés (et testés) une seule fois, les trois sorties ne peuvent pas se contredire.

export type TypeColonneEtat = "texte" | "entier" | "fcfa" | "date";

export interface ColonneEtat {
  cle: string;
  libelle: string;
  type: TypeColonneEtat;
  alignement: "gauche" | "droite";
  // largeur relative d'une colonne de texte dans le PDF (les autres types ont une largeur fixe) ; 1 par défaut
  poids?: number;
}

export interface SectionEtat {
  titre: string;
  colonnes: ColonneEtat[];
  lignes: (string | number)[][]; // mêmes colonnes, dans le même ordre
  totaux?: (string | number)[]; // ligne de totaux, mêmes colonnes ; le libellé (« Total ») est dans la première
  messageVide?: string; // montré quand `lignes` est vide
}

export interface EtatImprimable {
  identifiant: string; // « etat-des-ventes » : sert aussi à nommer les fichiers
  titre: string; // « État des ventes »
  periode: { du: string; au: string }; // AAAA-MM-JJ, jours de Douala
  entete: { nomBoutique: string; lignesContact: string[] };
  genereLe: string; // horodatage ISO
  sections: SectionEtat[];
  avertissements: string[]; // par exemple « Détail limité aux 5 000 premières factures… »
}

const formateurNombre = new Intl.NumberFormat("fr-FR");

const FORME_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const versDateFrancaise = (jour: string) => jour.split("-").reverse().join("/");

// Un texte placé dans une colonne de nombres (la ligne « Total ») reste un texte ; un nombre n'est mis en forme que dans une colonne de nombres.
// Le vrai signe moins (U+2212) que certaines versions d'ICU emploient est ramené au tiret : il n'existe pas dans la police standard du PDF.
export function formaterValeurEtat(valeur: string | number, type: TypeColonneEtat): string {
  if ((type === "entier" || type === "fcfa") && typeof valeur === "number") return formateurNombre.format(valeur).replace(/\u2212/g, "-");
  if (type === "date" && typeof valeur === "string" && FORME_JOUR.test(valeur)) return versDateFrancaise(valeur);
  return String(valeur);
}

export function libellePeriodeEtat(periode: { du: string; au: string }): string {
  return periode.du === periode.au ? `le ${versDateFrancaise(periode.du)}` : `du ${versDateFrancaise(periode.du)} au ${versDateFrancaise(periode.au)}`;
}

// « 17/11/2026 15:21 », à l'heure de Douala
export function dateHeureDouala(instantIso: string): string {
  return `${versDateFrancaise(jourDouala(instantIso))} ${heureDouala(instantIso)}`;
}

export function nomFichierEtat(etat: EtatImprimable, extension: "pdf" | "csv"): string {
  return `${etat.identifiant}-${etat.periode.du}-au-${etat.periode.au}.${extension}`;
}

// Excel en version française attend « ; ». Les montants restent des nombres bruts (Excel les calcule), les dates passent en JJ/MM/AAAA comme dans
// les journaux comptables. Une section après l'autre, séparées d'une ligne vide.
export function etatVersCsv(etat: EtatImprimable): string {
  const lignes: (string | number)[][] = [
    [etat.titre],
    ["Période", libellePeriodeEtat(etat.periode)],
    ["Boutique", etat.entete.nomBoutique],
    ["Généré le", dateHeureDouala(etat.genereLe)],
  ];
  for (const avertissement of etat.avertissements) lignes.push(["Avertissement", avertissement]);

  for (const section of etat.sections) {
    lignes.push([], [section.titre], section.colonnes.map((c) => c.libelle));
    if (section.lignes.length === 0) lignes.push([section.messageVide ?? "Aucune donnée"]);
    for (const ligne of section.lignes) {
      lignes.push(ligne.map((valeur, i) => (section.colonnes[i]?.type === "date" ? formaterValeurEtat(valeur, "date") : valeur)));
    }
    if (section.totaux) lignes.push(section.totaux);
  }
  return construireCsv(lignes[0], lignes.slice(1), ";");
}
```

Modifier `packages/shared/src/index.ts` : ajouter à la fin du fichier

```ts
export { dateHeureDouala, etatVersCsv, formaterValeurEtat, libellePeriodeEtat, nomFichierEtat, type ColonneEtat, type EtatImprimable, type SectionEtat, type TypeColonneEtat } from "./etat.js";
```

- [ ] **Étape 4 : constater le succès**

Run : `cd packages/shared && npx vitest run src/etat.test.ts && npx tsc --noEmit -p .`
Attendu : tous les tests passent, `tsc` sans erreur.

- [ ] **Étape 5 : mise de côté (aucun commit sans ordre)**

Fichiers de la tâche : `packages/shared/src/etat.ts`, `packages/shared/src/etat.test.ts`, `packages/shared/src/index.ts`. Ne rien commiter.

---

### Tâche 2 : raccourcis de période et vue « États » (code partagé)

**Fichiers :**
- Créer : `packages/shared/src/periodes-raccourcis.ts`
- Créer : `packages/shared/src/periodes-raccourcis.test.ts`
- Modifier : `packages/shared/src/acces-vues.ts`, `packages/shared/src/acces-vues.test.ts`, `packages/shared/src/index.ts`

**Interfaces :**
- Consomme : `decalerJour(jour, n)` (`plage-jours.ts`) et `periodeDuMois(jourReference, decalage)` (`periode-mois.ts`), déjà exportés.
- Produit : `ClePeriodeRaccourci`, `raccourcisPeriode(aujourdHui: string): { cle: ClePeriodeRaccourci; libelle: string; periode: { du: string; au: string } }[]` ; la vue `"etats"` dans `VueApplication` et `ROLES_PAR_VUE`.

- [ ] **Étape 1 : écrire les tests (ils échouent)**

Créer `packages/shared/src/periodes-raccourcis.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { raccourcisPeriode } from "./periodes-raccourcis.js";

const periodes = (jour: string) => Object.fromEntries(raccourcisPeriode(jour).map((r) => [r.cle, r.periode]));

describe("raccourcisPeriode", () => {
  it("un mardi (17 novembre 2026) : la semaine commence le lundi 16", () => {
    expect(periodes("2026-11-17")).toEqual({
      aujourdhui: { du: "2026-11-17", au: "2026-11-17" },
      hier: { du: "2026-11-16", au: "2026-11-16" },
      semaine: { du: "2026-11-16", au: "2026-11-17" },
      mois: { du: "2026-11-01", au: "2026-11-17" },
      moisDernier: { du: "2026-10-01", au: "2026-10-31" },
    });
  });

  it("un dimanche, la semaine en cours a commencé le lundi précédent (semaine du lundi au dimanche)", () => {
    expect(periodes("2026-11-15").semaine).toEqual({ du: "2026-11-09", au: "2026-11-15" });
  });

  it("un lundi, la semaine ne contient que ce jour", () => {
    expect(periodes("2026-11-16").semaine).toEqual({ du: "2026-11-16", au: "2026-11-16" });
  });

  it("le 1er du mois : « hier » est le dernier jour du mois précédent, « ce mois » se réduit à ce jour", () => {
    const p = periodes("2026-12-01");

    expect(p.hier).toEqual({ du: "2026-11-30", au: "2026-11-30" });
    expect(p.mois).toEqual({ du: "2026-12-01", au: "2026-12-01" });
    expect(p.moisDernier).toEqual({ du: "2026-11-01", au: "2026-11-30" });
  });

  it("en janvier, le mois dernier est décembre de l'année précédente", () => {
    expect(periodes("2027-01-10").moisDernier).toEqual({ du: "2026-12-01", au: "2026-12-31" });
  });

  it("donne les libellés de l'écran, dans l'ordre", () => {
    expect(raccourcisPeriode("2026-11-17").map((r) => r.libelle)).toEqual(["Aujourd'hui", "Hier", "Cette semaine", "Ce mois", "Mois dernier"]);
  });
});
```

Dans `packages/shared/src/acces-vues.test.ts`, remplacer le tableau `ATTENDU` par :

```ts
  const ATTENDU: Record<RoleUtilisateur, VueApplication[]> = {
    ADMINISTRATEUR: ["dashboard", "caisse", "sav", "clients", "apporteurs", "stock", "etats", "administration"],
    GERANT: ["dashboard", "caisse", "sav", "clients", "apporteurs", "stock", "etats", "administration"],
    CAISSIER: ["dashboard", "caisse", "sav", "clients"],
    TECHNICIEN_SAV: ["dashboard", "sav"],
    COMPTABLE: ["dashboard", "clients", "etats"],
    APPORTEUR: [],
  };
```

et ajouter, avant le test « un rôle inconnu n'accède à rien » :

```ts
  it("réserve les États au pilotage financier : refusés au Caissier, au Technicien SAV et à l'Apporteur", () => {
    expect(peutAccederVue("CAISSIER", "etats")).toBe(false);
    expect(peutAccederVue("TECHNICIEN_SAV", "etats")).toBe(false);
    expect(peutAccederVue("APPORTEUR", "etats")).toBe(false);
    expect(peutAccederVue("COMPTABLE", "etats")).toBe(true);
  });
```

- [ ] **Étape 2 : constater l'échec**

Run : `cd packages/shared && npx vitest run src/periodes-raccourcis.test.ts src/acces-vues.test.ts`
Attendu : échec (module absent ; vue `etats` inconnue).

- [ ] **Étape 3 : écrire l'implémentation**

Créer `packages/shared/src/periodes-raccourcis.ts` :

```ts
import { decalerJour } from "./plage-jours.js";
import { periodeDuMois } from "./periode-mois.js";

export type ClePeriodeRaccourci = "aujourdhui" | "hier" | "semaine" | "mois" | "moisDernier";

// Les raccourcis de période de l'écran des états. Jours de Douala, `aujourdHui` au format AAAA-MM-JJ. La semaine va du lundi à aujourd'hui.
export function raccourcisPeriode(aujourdHui: string): { cle: ClePeriodeRaccourci; libelle: string; periode: { du: string; au: string } }[] {
  // getUTCDay : 0 = dimanche … 6 = samedi ; le lundi précédent est à (jour + 6) % 7 jours en arrière
  const joursDepuisLundi = (new Date(`${aujourdHui}T00:00:00Z`).getUTCDay() + 6) % 7;
  const hier = decalerJour(aujourdHui, -1);
  return [
    { cle: "aujourdhui", libelle: "Aujourd'hui", periode: { du: aujourdHui, au: aujourdHui } },
    { cle: "hier", libelle: "Hier", periode: { du: hier, au: hier } },
    { cle: "semaine", libelle: "Cette semaine", periode: { du: decalerJour(aujourdHui, -joursDepuisLundi), au: aujourdHui } },
    { cle: "mois", libelle: "Ce mois", periode: { du: periodeDuMois(aujourdHui).du, au: aujourdHui } },
    { cle: "moisDernier", libelle: "Mois dernier", periode: periodeDuMois(aujourdHui, -1) },
  ];
}
```

Dans `packages/shared/src/acces-vues.ts` :

1. remplacer la ligne `export type VueApplication = ...` par :

```ts
export type VueApplication = "dashboard" | "caisse" | "sav" | "clients" | "apporteurs" | "stock" | "etats" | "administration";
```

2. dans `ROLES_PAR_VUE`, ajouter entre la ligne `stock` et la ligne `administration` :

```ts
  etats: ["ADMINISTRATEUR", "GERANT", "COMPTABLE"], // états de gestion : pilotage financier (exigerRole « pilotage »)
```

Dans `packages/shared/src/index.ts`, ajouter :

```ts
export { raccourcisPeriode, type ClePeriodeRaccourci } from "./periodes-raccourcis.js";
```

- [ ] **Étape 4 : constater le succès**

Run : `cd packages/shared && npx vitest run && npx tsc --noEmit -p .`
Attendu : toute la suite partagée passe, `tsc` sans erreur.

- [ ] **Étape 5 : mise de côté (aucun commit sans ordre)**

Fichiers de la tâche : `packages/shared/src/periodes-raccourcis.ts`, `packages/shared/src/periodes-raccourcis.test.ts`, `packages/shared/src/acces-vues.ts`, `packages/shared/src/acces-vues.test.ts`, `packages/shared/src/index.ts`.

---

### Tâche 3 : extraire le journal des ventes de l'export comptable

**Fichiers :**
- Modifier : `apps/api/src/modules/export-comptable/export-comptable.service.ts`
- Modifier : `apps/api/src/modules/tableau-bord/tableau-bord.service.ts`
- Créer : `apps/api/src/modules/export-comptable/export-comptable-journal.test.ts`

**Interfaces :**
- Produit : `LigneJournalVentes` (voir ci-dessous) ; `listerJournalVentes(db: Db, siteId: number, periode: PeriodeExport): { lignes: LigneJournalVentes[] }` ; `facturesDeLaPeriode(db, siteId, periode)` et `paiementsDeLaPeriode(siteId, periode)` désormais exportées ; `creerResolveurFamilleLigne(db)` exportée de `tableau-bord.service.ts`.
- Garantie : `exporterJournalVentesCsv` produit exactement le même CSV qu'avant (ses tests existants le prouvent).

- [ ] **Étape 1 : écrire les tests du journal structuré (ils échouent)**

Créer `apps/api/src/modules/export-comptable/export-comptable-journal.test.ts` :

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { exporterJournalVentesCsv, listerJournalVentes } from "./export-comptable.service.js";

let db: Db;
let siteId: number;
let userId: number;
let idAbonne: number;
let idProduit: number;
let numeroAbonnement: number;

const PERIODE = { du: "2026-11-01", au: "2026-11-30" };

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555" }).returning().get().idAbonne;
  idProduit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500 }).returning().get().idProduit;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  const idFormule = db.insert(schema.formule).values({ idFamille: famille, libelle: "EVASION", prix: 10500, rang: 3 }).returning().get().idFormule;
  numeroAbonnement = db.insert(schema.abonnement).values({ idAbonne, idFormule, siteId, dateDebut: "2026-11-01", dateFin: "2026-11-30", creePar: userId }).returning().get().numeroAbonnement;
});

function facture(partiel: Partial<typeof schema.facture.$inferInsert> = {}) {
  return db
    .insert(schema.facture)
    .values({ siteId, idAbonne, creePar: userId, statut: "VALIDEE", montantTotal: 11900, montantTaxe: 1900, dateCreation: "2026-11-03 09:00:00", ...partiel })
    .returning()
    .get();
}

describe("listerJournalVentes : les lignes du journal, avant leur mise en forme CSV", () => {
  it("une ligne structurée par facture validée : date, client, détail, TTC, TVA, HT, encaissé, reste dû", () => {
    const f = facture();
    db.insert(schema.ligneVente).values({ idFacture: f.idFacture, numeroAbonnement, prixApplique: 10500 }).run();
    db.insert(schema.ligneVente).values({ idFacture: f.idFacture, idProduit, quantite: 2, prixApplique: 700 }).run();
    db.insert(schema.paiement).values({ idFacture: f.idFacture, mode: "CASH", montant: 10000, utilisateurId: userId, datePaiement: "2026-11-03 09:05:00" }).run();

    const { lignes } = listerJournalVentes(db, siteId, PERIODE);

    expect(lignes).toEqual([
      {
        idFacture: f.idFacture,
        date: "2026-11-03",
        type: "VENTE",
        factureOrigineId: null,
        idAbonne,
        client: "Marie Ngo",
        detail: "1 × EVASION + 2 × Câble HDMI",
        totalTtc: 11900,
        taxe: 1900,
        totalHt: 10000,
        encaisse: 10000,
        resteAPayer: 1900,
      },
    ]);
  });

  it("la date est celle de Douala : une vente à 23 h 30 UTC appartient au jour suivant", () => {
    facture({ dateCreation: "2026-11-03 23:30:00" });

    expect(listerJournalVentes(db, siteId, PERIODE).lignes[0].date).toBe("2026-11-04");
  });

  it("un avoir est une ligne en négatif, sans reste à payer, qui renvoie à sa facture d'origine", () => {
    const vente = facture();
    const avoir = facture({ type: "AVOIR", factureOrigineId: vente.idFacture, montantTotal: -2500, montantTaxe: 0, dateCreation: "2026-11-04 10:00:00" });

    const lignes = listerJournalVentes(db, siteId, PERIODE).lignes;

    expect(lignes.map((l) => [l.idFacture, l.type, l.totalTtc, l.resteAPayer])).toEqual([
      [vente.idFacture, "VENTE", 11900, 11900 - 2500], // le reste d'une vente tient compte de son avoir
      [avoir.idFacture, "AVOIR", -2500, 0],
    ]);
    expect(lignes[1].factureOrigineId).toBe(vente.idFacture);
  });

  it("le CSV de l'export comptable en est exactement la mise en forme : même nombre de lignes", () => {
    facture();
    facture({ dateCreation: "2026-11-05 10:00:00" });

    const { lignes } = listerJournalVentes(db, siteId, PERIODE);
    const { nombre, csv } = exporterJournalVentesCsv(db, siteId, PERIODE);

    expect(nombre).toBe(lignes.length);
    expect(csv.split("\r\n")).toHaveLength(lignes.length + 1);
  });
});
```

- [ ] **Étape 2 : constater l'échec**

Run : `cd apps/api && npx vitest run src/modules/export-comptable/export-comptable-journal.test.ts`
Attendu : échec, `listerJournalVentes` n'existe pas.

- [ ] **Étape 3 : refactorer**

Dans `apps/api/src/modules/export-comptable/export-comptable.service.ts` :

1. Rendre exportées les deux fonctions de filtre : remplacer `function facturesDeLaPeriode(` par `export function facturesDeLaPeriode(` et `function paiementsDeLaPeriode(` par `export function paiementsDeLaPeriode(`.

2. Remplacer la fonction `exporterJournalVentesCsv` en entier, depuis son commentaire d'en-tête « // Journal des ventes : une ligne par facture validée… » jusqu'à son `}` fermant (juste avant `const LIBELLE_MODE`), par ce bloc :

```ts
// Journal des ventes : une ligne par facture validée (les ventes en attente de paiement n'en font pas partie, comme du chiffre
// d'affaires), les avoirs en négatif avec la facture qu'ils corrigent. Le plus ancien en premier.
export interface LigneJournalVentes {
  idFacture: number;
  date: string; // AAAA-MM-JJ, jour de Douala
  type: "VENTE" | "AVOIR";
  factureOrigineId: number | null;
  idAbonne: number | null;
  client: string;
  detail: string;
  totalTtc: number;
  taxe: number;
  totalHt: number;
  encaisse: number;
  resteAPayer: number;
}

// Les lignes du journal avant leur mise en forme : l'export comptable (CSV) et l'état des ventes s'appuient sur ce seul calcul.
export function listerJournalVentes(db: Db, siteId: number, periode: PeriodeExport): { lignes: LigneJournalVentes[] } {
  verifierPeriodeExport(periode);
  const filtre = facturesDeLaPeriode(db, siteId, periode);

  const factures = db
    .select({ facture: schema.facture, prenom: schema.abonne.prenom, nom: schema.abonne.nom })
    .from(schema.facture)
    .leftJoin(schema.abonne, eq(schema.facture.idAbonne, schema.abonne.idAbonne))
    .where(filtre)
    .orderBy(asc(schema.facture.dateCreation), asc(schema.facture.idFacture))
    .all();

  // en une requête pour toute la période, jamais une par facture ni une liste de numéros (limite de variables de SQLite)
  const lignesDeVente = db
    .select({
      idFacture: schema.ligneVente.idFacture,
      quantite: schema.ligneVente.quantite,
      produit: schema.produit.libelle,
      kit: schema.kit.libelle,
      option: schema.optionComplement.libelle,
      formule: schema.formule.libelle,
    })
    .from(schema.ligneVente)
    .innerJoin(schema.facture, eq(schema.ligneVente.idFacture, schema.facture.idFacture))
    .leftJoin(schema.produit, eq(schema.ligneVente.idProduit, schema.produit.idProduit))
    .leftJoin(schema.kit, eq(schema.ligneVente.idKit, schema.kit.idKit))
    .leftJoin(schema.optionComplement, eq(schema.ligneVente.idOption, schema.optionComplement.idOption))
    .leftJoin(schema.abonnement, eq(schema.ligneVente.numeroAbonnement, schema.abonnement.numeroAbonnement))
    .leftJoin(schema.formule, eq(schema.abonnement.idFormule, schema.formule.idFormule))
    .where(filtre)
    .orderBy(asc(schema.ligneVente.idLigne))
    .all();
  const detailParFacture = new Map<number, string[]>();
  for (const l of lignesDeVente) {
    const libelle = l.produit ?? l.kit ?? l.option ?? l.formule ?? "Ligne sans libellé";
    detailParFacture.set(l.idFacture, [...(detailParFacture.get(l.idFacture) ?? []), `${l.quantite} × ${libelle}`]);
  }

  const encaisse = new Map(
    db
      .select({ idFacture: schema.paiement.idFacture, total: sql<number>`sum(${schema.paiement.montant})` })
      .from(schema.paiement)
      .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
      .where(filtre)
      .groupBy(schema.paiement.idFacture)
      .all()
      .map((p) => [p.idFacture, p.total]),
  );

  // avoirs de ces ventes, émis à n'importe quelle date : comme les encaissements, le reste à payer est celui d'aujourd'hui
  const avoirsParVente = new Map(
    db
      .select({ idOrigine: schema.facture.factureOrigineId, total: sql<number>`sum(${schema.facture.montantTotal})` })
      .from(schema.facture)
      .where(
        and(
          eq(schema.facture.type, "AVOIR"),
          inArray(schema.facture.factureOrigineId, db.select({ id: schema.facture.idFacture }).from(schema.facture).where(filtre)),
        ),
      )
      .groupBy(schema.facture.factureOrigineId)
      .all()
      .map((a) => [a.idOrigine, a.total]),
  );

  const lignes = factures.map(({ facture: f, prenom, nom }): LigneJournalVentes => {
    const paye = encaisse.get(f.idFacture) ?? 0;
    // même règle que l'application (solde = total + avoirs − encaissé) : une vente remboursée par avoir n'est pas une dette ; un avoir
    // non remboursé est un crédit du client (négatif). L'avoir lui-même est déjà déduit de sa vente : jamais une dette.
    const reste = f.type === "AVOIR" ? 0 : f.montantTotal + (avoirsParVente.get(f.idFacture) ?? 0) - paye;
    return {
      idFacture: f.idFacture,
      date: jourDouala(f.dateCreation),
      type: f.type,
      factureOrigineId: f.factureOrigineId,
      idAbonne: f.idAbonne,
      client: nomComplet(prenom, nom),
      detail: (detailParFacture.get(f.idFacture) ?? []).join(" + "),
      totalTtc: f.montantTotal,
      taxe: f.montantTaxe,
      totalHt: f.montantTotal - f.montantTaxe,
      encaisse: paye,
      resteAPayer: reste,
    };
  });
  return { lignes };
}

const dateFrancaise = (jour: string) => jour.split("-").reverse().join("/");

export function exporterJournalVentesCsv(db: Db, siteId: number, periode: PeriodeExport): { csv: string; nombre: number } {
  const { lignes } = listerJournalVentes(db, siteId, periode);
  const donnees = lignes.map((l) => [
    dateFrancaise(l.date),
    l.idFacture,
    l.type === "AVOIR" ? "Avoir" : "Vente",
    l.factureOrigineId ?? "",
    l.idAbonne ?? "",
    l.client,
    l.detail,
    l.totalTtc,
    l.taxe,
    l.totalHt,
    l.encaisse,
    l.resteAPayer,
  ]);

  const entetes = ["Date", "N° facture", "Type", "Facture d'origine", "N° client", "Client", "Détail", "Total TTC", "dont TVA", "Total HT", "Encaissé", "Reste à payer"];
  return { csv: construireCsv(entetes, donnees, ";"), nombre: donnees.length };
}
```

Dans `apps/api/src/modules/tableau-bord/tableau-bord.service.ts`, remplacer `function creerResolveurFamilleLigne(db: Db)` par `export function creerResolveurFamilleLigne(db: Db)`.

- [ ] **Étape 4 : constater le succès, y compris la non-régression**

Run : `cd apps/api && npx tsc --noEmit -p . && npx vitest run src/modules/export-comptable src/modules/tableau-bord`
Attendu : `tsc` sans erreur ; les tests nouveaux **et tous les tests existants** de l'export comptable et du tableau de bord passent (le CSV est inchangé).

- [ ] **Étape 5 : mise de côté (aucun commit sans ordre)**

Fichiers de la tâche : `apps/api/src/modules/export-comptable/export-comptable.service.ts`, `apps/api/src/modules/export-comptable/export-comptable-journal.test.ts`, `apps/api/src/modules/tableau-bord/tableau-bord.service.ts`.

---

### Tâche 4 : le jeu de données, et le constructeur de l'état des ventes (jours, détail, totaux)

**Fichiers :**
- Créer : `apps/api/src/test-utils/fixture-etat-ventes.ts`
- Créer : `apps/api/src/modules/etats/etat-ventes.service.ts`
- Créer : `apps/api/src/modules/etats/etat-ventes.service.test.ts`

**Interfaces :**
- Consomme : `listerJournalVentes`, `verifierPeriodeExport`, `LigneJournalVentes`, `PeriodeExport` (tâche 3) ; `EtatImprimable`, `SectionEtat`, `lignesContactBoutique` (tâche 1 et code partagé) ; `trouverInfosEntrepriseParSite(db, siteId)`.
- Produit : `LIMITE_DETAIL_PAR_DEFAUT = 5000` ; `OptionsEtatVentes { limiteDetail?: number; maintenant?: Date }` ; `construireEtatVentes(db: Db, siteId: number, periode: PeriodeExport, options?: OptionsEtatVentes): EtatImprimable` ; `creerFixtureEtatVentes(db): FixtureEtatVentes`.
- Au terme de cette tâche, l'état contient trois sections, dans cet ordre : « Récapitulatif par jour », « Détail facture par facture », « Totaux de la période » (quatre lignes). La tâche 5 y ajoute les familles, les modes de paiement et l'encaissé.

**Le jeu de données (valeurs que les tests de ce plan supposent).** Période de référence `2026-11-01` → `2026-11-30`, boutique A. Jours de Douala (UTC+1).

| Facture | Date de création (UTC) | Contenu | TTC | TVA | Paiements |
|---|---|---|---|---|---|
| F1 | 03/11 09:00 | formule EVASION (CANAL+) 10 500 + 1 câble 1 400 | 11 900 | 1 900 | espèces 11 900 le 03/11 |
| F2 | 03/11 23:30 (donc **04/11** à Douala) | formule Netflix « 1 mois » 3 500 | 3 500 | 0 | virement 2 000 le 03/11 ; espèces 1 500 le 01/12 |
| F3 | 05/11 10:00 | 2 câbles 5 000 | 5 000 | 0 | chèque 5 000 le 05/11 ; **remboursement** espèces −2 500 le 06/11 |
| Avoir | 06/11 11:00 | 1 câble −2 500, origine F3 | −2 500 | 0 | aucun (le remboursement est sur F3) |
| F4 | 07/11 08:00, sans client | main d'œuvre SAV 3 000 | 3 000 | 0 | Mobile Money 3 000 le 07/11 |
| F5 | 09/11 10:00 | 4 câbles 4 000 | 4 000 | 0 | espèces 1 000 le 09/11 (impayé partiel) |

Exclus du périmètre : un brouillon (09999 FCFA, 08/11), une facture de la boutique B (7 777 FCFA, 08/11, avec un paiement espèces de 7 777), une facture de décembre (1 234 FCFA, 02/12).
Totaux attendus sur novembre : TTC net 24 900, TVA 1 900, HT 23 000, reste à payer 3 000 (F5), 6 lignes de journal (5 ventes et 1 avoir).

- [ ] **Étape 1 : créer le jeu de données**

Créer `apps/api/src/test-utils/fixture-etat-ventes.ts` :

```ts
import * as schema from "../db/schema.js";
import type { Db } from "./db.js";

export interface FixtureEtatVentes {
  siteId: number;
  autreSiteId: number;
  userId: number;
  idAbonne: number;
  factures: { f1: number; f2: number; f3: number; avoir: number; f4: number; f5: number };
}

// Jeu de données des tests d'états : voir la table du plan (docs/superpowers/plans/2026-11-17-etat-des-ventes.md, tâche 4). Les dates sont en UTC,
// comme dans la base : F2 est créée à 23 h 30 UTC, donc le 04/11 à Douala.
export function creerFixtureEtatVentes(db: Db): FixtureEtatVentes {
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const siteId = db
    .insert(schema.site)
    .values({ idEntreprise: ent.idEntreprise, nom: "Douala — Akwa", adresse: "Boulevard de la Liberté", telephone: "677 00 00 00" })
    .returning()
    .get().idSite;
  const autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  const userId = db.insert(schema.utilisateur).values({ siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  const idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555" }).returning().get().idAbonne;

  const canal = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  const netflix = db.insert(schema.familleAbonnement).values({ libelle: "Netflix" }).returning().get().idFamille;
  const evasion = db.insert(schema.formule).values({ idFamille: canal, libelle: "EVASION", prix: 10500, rang: 3 }).returning().get().idFormule;
  const unMois = db.insert(schema.formule).values({ idFamille: netflix, libelle: "1 mois", prix: 3500, rang: 1 }).returning().get().idFormule;
  const abonnementCanal = db.insert(schema.abonnement).values({ idAbonne, idFormule: evasion, siteId, dateDebut: "2026-11-01", dateFin: "2026-11-30", creePar: userId }).returning().get().numeroAbonnement;
  const abonnementNetflix = db.insert(schema.abonnement).values({ idAbonne, idFormule: unMois, siteId, dateDebut: "2026-11-04", dateFin: "2026-12-03", creePar: userId }).returning().get().numeroAbonnement;
  const cable = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500 }).returning().get().idProduit;
  const mainOeuvre = db.insert(schema.produit).values({ siteId, type: "SAV", libelle: "Main d'œuvre SAV", prixVente: 3000 }).returning().get().idProduit;

  const facture = (valeurs: Partial<typeof schema.facture.$inferInsert> & { montantTotal: number; dateCreation: string }) =>
    db
      .insert(schema.facture)
      .values({ siteId, idAbonne, creePar: userId, statut: "VALIDEE", montantTaxe: 0, ...valeurs })
      .returning()
      .get().idFacture;
  const ligne = (idFacture: number, valeurs: Partial<typeof schema.ligneVente.$inferInsert> & { prixApplique: number }) =>
    db.insert(schema.ligneVente).values({ idFacture, ...valeurs }).run();
  const paiement = (idFacture: number, mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY", montant: number, datePaiement: string) =>
    db.insert(schema.paiement).values({ idFacture, mode, montant, utilisateurId: userId, datePaiement }).run();

  const f1 = facture({ montantTotal: 11900, montantTaxe: 1900, dateCreation: "2026-11-03 09:00:00" });
  ligne(f1, { numeroAbonnement: abonnementCanal, prixApplique: 10500 });
  ligne(f1, { idProduit: cable, quantite: 1, prixApplique: 1400 });
  paiement(f1, "CASH", 11900, "2026-11-03 09:05:00");

  const f2 = facture({ montantTotal: 3500, dateCreation: "2026-11-03 23:30:00" });
  ligne(f2, { numeroAbonnement: abonnementNetflix, prixApplique: 3500 });
  paiement(f2, "VIREMENT", 2000, "2026-11-03 23:35:00");
  paiement(f2, "CASH", 1500, "2026-12-01 10:00:00");

  const f3 = facture({ montantTotal: 5000, dateCreation: "2026-11-05 10:00:00" });
  ligne(f3, { idProduit: cable, quantite: 2, prixApplique: 5000 });
  paiement(f3, "CHEQUE", 5000, "2026-11-05 10:01:00");

  const avoir = facture({ type: "AVOIR", factureOrigineId: f3, montantTotal: -2500, dateCreation: "2026-11-06 11:00:00" });
  ligne(avoir, { idProduit: cable, quantite: 1, prixApplique: -2500 });
  paiement(f3, "CASH", -2500, "2026-11-06 11:01:00"); // le remboursement est rattaché à la facture d'origine, comme dans l'application

  const f4 = facture({ idAbonne: null, montantTotal: 3000, dateCreation: "2026-11-07 08:00:00" });
  ligne(f4, { idProduit: mainOeuvre, quantite: 1, prixApplique: 3000 });
  paiement(f4, "MOBILE_MONEY", 3000, "2026-11-07 08:05:00");

  const f5 = facture({ montantTotal: 4000, dateCreation: "2026-11-09 10:00:00" });
  ligne(f5, { idProduit: cable, quantite: 4, prixApplique: 4000 });
  paiement(f5, "CASH", 1000, "2026-11-09 10:05:00");

  // hors périmètre : brouillon, autre boutique, autre mois
  facture({ statut: "BROUILLON", montantTotal: 9999, dateCreation: "2026-11-08 10:00:00" });
  const autreSite = facture({ siteId: autreSiteId, idAbonne: null, montantTotal: 7777, dateCreation: "2026-11-08 12:00:00" });
  paiement(autreSite, "CASH", 7777, "2026-11-08 12:05:00");
  facture({ montantTotal: 1234, dateCreation: "2026-12-02 10:00:00" });

  return { siteId, autreSiteId, userId, idAbonne, factures: { f1, f2, f3, avoir, f4, f5 } };
}
```

- [ ] **Étape 2 : écrire les tests du constructeur (ils échouent)**

Créer `apps/api/src/modules/etats/etat-ventes.service.test.ts` :

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { SectionEtat } from "@mboapilot/shared";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerFixtureEtatVentes, type FixtureEtatVentes } from "../../test-utils/fixture-etat-ventes.js";
import { construireEtatVentes, espacerMilliers } from "./etat-ventes.service.js";

let db: Db;
let fx: FixtureEtatVentes;

const NOVEMBRE = { du: "2026-11-01", au: "2026-11-30" };
const MAINTENANT = new Date("2026-11-17T14:21:00.000Z");

beforeEach(() => {
  db = creerDbTest();
  fx = creerFixtureEtatVentes(db);
});

const section = (sections: SectionEtat[], titre: string) => {
  const trouvee = sections.find((s) => s.titre === titre);
  if (!trouvee) throw new Error(`section « ${titre} » absente : ${sections.map((s) => s.titre).join(", ")}`);
  return trouvee;
};

describe("construireEtatVentes : l'en-tête", () => {
  it("porte le titre, la période, la boutique et ses coordonnées, et la date de génération", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE, { maintenant: MAINTENANT });

    expect(etat.identifiant).toBe("etat-des-ventes");
    expect(etat.titre).toBe("État des ventes");
    expect(etat.periode).toEqual(NOVEMBRE);
    expect(etat.entete).toEqual({ nomBoutique: "Boutique Test", lignesContact: ["Douala — Akwa", "Boulevard de la Liberté", "Tél : 677 00 00 00"] });
    expect(etat.genereLe).toBe("2026-11-17T14:21:00.000Z");
    expect(etat.avertissements).toEqual([]);
  });

  it("refuse une période invalide, inversée ou trop longue, avec le message de l'export comptable", () => {
    expect(() => construireEtatVentes(db, fx.siteId, { du: "2026-11-30", au: "2026-11-01" })).toThrow(/inversée/);
    expect(() => construireEtatVentes(db, fx.siteId, { du: "2026-02-30", au: "2026-03-01" })).toThrow(/date de début/);
    expect(() => construireEtatVentes(db, fx.siteId, { du: "2025-01-01", au: "2026-11-30" })).toThrow(/trop longue/);
  });
});

describe("construireEtatVentes : récapitulatif par jour", () => {
  it("une ligne par jour avec activité, sur le jour de Douala, avoir en négatif, et le total", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Récapitulatif par jour");

    expect(s.colonnes.map((c) => c.libelle)).toEqual(["Jour", "Ventes", "Avoirs", "Total TTC", "dont TVA", "Total HT"]);
    expect(s.lignes).toEqual([
      ["2026-11-03", 1, 0, 11900, 1900, 10000],
      ["2026-11-04", 1, 0, 3500, 0, 3500], // F2 créée à 23 h 30 UTC le 03/11 : le 04/11 à Douala
      ["2026-11-05", 1, 0, 5000, 0, 5000],
      ["2026-11-06", 0, 1, -2500, 0, -2500],
      ["2026-11-07", 1, 0, 3000, 0, 3000],
      ["2026-11-09", 1, 0, 4000, 0, 4000],
    ]);
    expect(s.totaux).toEqual(["Total", 5, 1, 24900, 1900, 23000]);
  });

  it("ne reprend ni le brouillon, ni l'autre boutique, ni le mois suivant", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Récapitulatif par jour");

    expect(s.lignes.map((l) => l[0])).not.toContain("2026-11-08");
    expect(s.lignes.map((l) => l[0])).not.toContain("2026-12-02");
  });

  it("une période sans vente : aucune ligne, le message, des totaux à zéro", () => {
    const s = section(construireEtatVentes(db, fx.siteId, { du: "2026-01-01", au: "2026-01-31" }).sections, "Récapitulatif par jour");

    expect(s.lignes).toEqual([]);
    expect(s.messageVide).toBe("Aucune vente sur cette période");
    expect(s.totaux).toEqual(["Total", 0, 0, 0, 0, 0]);
  });
});

describe("construireEtatVentes : détail facture par facture", () => {
  it("une ligne par facture, la plus ancienne d'abord : date, n°, type, client, détail, TTC, encaissé, reste", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Détail facture par facture");
    const { f1, f2, f3, avoir, f4, f5 } = fx.factures;

    expect(s.colonnes.map((c) => c.libelle)).toEqual(["Date", "N°", "Type", "Client", "Détail", "Total TTC", "Encaissé", "Reste à payer"]);
    expect(s.lignes).toEqual([
      ["2026-11-03", f1, "Vente", "Marie Ngo", "1 × EVASION + 1 × Câble HDMI", 11900, 11900, 0],
      ["2026-11-04", f2, "Vente", "Marie Ngo", "1 × 1 mois", 3500, 3500, 0], // acompte le 03/11 + solde le 01/12 : soldée aujourd'hui
      ["2026-11-05", f3, "Vente", "Marie Ngo", "2 × Câble HDMI", 5000, 2500, 0], // chèque 5 000 − remboursement 2 500
      ["2026-11-06", avoir, "Avoir", "Marie Ngo", "1 × Câble HDMI", -2500, 0, 0],
      ["2026-11-07", f4, "Vente", "Sans client", "1 × Main d'œuvre SAV", 3000, 3000, 0],
      ["2026-11-09", f5, "Vente", "Marie Ngo", "4 × Câble HDMI", 4000, 1000, 3000], // impayé partiel
    ]);
    expect(s.totaux).toEqual(["Total", "", "", "", "", 24900, 21900, 3000]);
  });

  it("une période sans vente : le message, et des totaux à zéro", () => {
    const s = section(construireEtatVentes(db, fx.siteId, { du: "2026-01-01", au: "2026-01-31" }).sections, "Détail facture par facture");

    expect(s.lignes).toEqual([]);
    expect(s.messageVide).toBe("Aucune vente sur cette période");
    expect(s.totaux).toEqual(["Total", "", "", "", "", 0, 0, 0]);
  });
});

describe("construireEtatVentes : garde-fou de volume", () => {
  it("au-delà de la limite, le détail est coupé, avec l'avertissement ; les autres sections et les totaux restent complets", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE, { limiteDetail: 2 });
    const detail = section(etat.sections, "Détail facture par facture");

    expect(detail.lignes.map((l) => l[1])).toEqual([fx.factures.f1, fx.factures.f2]);
    expect(detail.totaux).toBeUndefined(); // un total sur un détail coupé tromperait
    expect(etat.avertissements).toEqual(["Détail limité aux 2 premières factures : réduisez la période ou utilisez le CSV."]);
    expect(section(etat.sections, "Récapitulatif par jour").totaux).toEqual(["Total", 5, 1, 24900, 1900, 23000]);
    expect(section(etat.sections, "Totaux de la période").lignes[0]).toEqual(["Total TTC (net des avoirs)", 24900]);
  });

  it("n'avertit pas tant que la limite n'est pas dépassée, et dit combien de factures sont montrées quand elle l'est", () => {
    // 6 lignes de journal : limite atteinte, pas dépassée
    expect(construireEtatVentes(db, fx.siteId, NOVEMBRE, { limiteDetail: 6 }).avertissements).toEqual([]);
    expect(construireEtatVentes(db, fx.siteId, NOVEMBRE, { limiteDetail: 3 }).avertissements).toEqual(["Détail limité aux 3 premières factures : réduisez la période ou utilisez le CSV."]);
  });

  it("espacerMilliers écrit les milliers avec une espace simple (le PDF ne sait pas écrire l'espace insécable fine)", () => {
    expect([999, 1000, 1500, 5000, 1234567].map(espacerMilliers)).toEqual(["999", "1 000", "1 500", "5 000", "1 234 567"]);
  });

  it("la limite par défaut est de 5 000 factures", async () => {
    const { LIMITE_DETAIL_PAR_DEFAUT } = await import("./etat-ventes.service.js");
    expect(LIMITE_DETAIL_PAR_DEFAUT).toBe(5000);
  });
});

describe("construireEtatVentes : totaux de la période", () => {
  it("TTC net des avoirs, TVA, HT et reste à payer des ventes de la période", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Totaux de la période");

    expect(s.colonnes.map((c) => c.libelle)).toEqual(["Libellé", "Montant"]);
    expect(s.lignes).toEqual([
      ["Total TTC (net des avoirs)", 24900],
      ["dont TVA", 1900],
      ["Total HT", 23000],
      ["Reste à payer des ventes de la période", 3000],
    ]);
  });

  it("la boutique B ne voit que ses propres ventes", () => {
    const s = section(construireEtatVentes(db, fx.autreSiteId, NOVEMBRE).sections, "Totaux de la période");

    expect(s.lignes[0]).toEqual(["Total TTC (net des avoirs)", 7777]);
  });

  it("la section des totaux vient en dernier", () => {
    const titres = construireEtatVentes(db, fx.siteId, NOVEMBRE).sections.map((s) => s.titre);

    expect(titres).toEqual(["Récapitulatif par jour", "Détail facture par facture", "Totaux de la période"]);
  });
});
```

- [ ] **Étape 3 : constater l'échec**

Run : `cd apps/api && npx vitest run src/modules/etats/etat-ventes.service.test.ts`
Attendu : échec, le module `etat-ventes.service.js` n'existe pas.

- [ ] **Étape 4 : écrire le constructeur**

Créer `apps/api/src/modules/etats/etat-ventes.service.ts` :

```ts
import { lignesContactBoutique, type EtatImprimable, type SectionEtat } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import { trouverInfosEntrepriseParSite } from "../entreprise/entreprise.repository.js";
import { listerJournalVentes, verifierPeriodeExport, type LigneJournalVentes, type PeriodeExport } from "../export-comptable/export-comptable.service.js";

// État des ventes (premier des états de gestion) : une période, des sections, des totaux. Toute la logique de calcul est celle de l'application :
// ventes validées de la boutique de la session, jour de Douala, avoirs en négatif, TVA figée sur la facture. Le détail vient du journal des ventes de
// l'export comptable (un seul calcul pour les deux).

export const LIMITE_DETAIL_PAR_DEFAUT = 5000;
const MESSAGE_AUCUNE_VENTE = "Aucune vente sur cette période";

export interface OptionsEtatVentes {
  limiteDetail?: number; // nombre maximal de factures montrées dans le détail
  maintenant?: Date; // instant de génération (injectable pour les tests)
}

// « 5000 » devient « 5 000 » (espace simple : le PDF ne sait pas écrire l'espace insécable fine)
export const espacerMilliers = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

function entete(db: Db, siteId: number): EtatImprimable["entete"] {
  const infos = trouverInfosEntrepriseParSite(db, siteId);
  if (!infos) return { nomBoutique: "Boutique", lignesContact: [] };
  const { entreprise, site } = infos;
  return {
    nomBoutique: entreprise.nom,
    lignesContact: [site.nom, site.adresse ?? "", ...lignesContactBoutique(site)].filter((ligne) => ligne.trim() !== ""),
  };
}

type ChampSomme = "totalTtc" | "taxe" | "totalHt" | "encaisse" | "resteAPayer";
const somme = (journal: LigneJournalVentes[], champ: ChampSomme) => journal.reduce((total, l) => total + l[champ], 0);

function sectionParJour(journal: LigneJournalVentes[]): SectionEtat {
  const parJour = new Map<string, { ventes: number; avoirs: number; ttc: number; tva: number; ht: number }>();
  for (const l of journal) {
    const jour = parJour.get(l.date) ?? { ventes: 0, avoirs: 0, ttc: 0, tva: 0, ht: 0 };
    if (l.type === "AVOIR") jour.avoirs += 1;
    else jour.ventes += 1;
    jour.ttc += l.totalTtc;
    jour.tva += l.taxe;
    jour.ht += l.totalHt;
    parJour.set(l.date, jour);
  }
  const jours = [...parJour.entries()].sort(([a], [b]) => a.localeCompare(b));
  return {
    titre: "Récapitulatif par jour",
    colonnes: [
      { cle: "jour", libelle: "Jour", type: "date", alignement: "gauche" },
      { cle: "ventes", libelle: "Ventes", type: "entier", alignement: "droite" },
      { cle: "avoirs", libelle: "Avoirs", type: "entier", alignement: "droite" },
      { cle: "ttc", libelle: "Total TTC", type: "fcfa", alignement: "droite" },
      { cle: "tva", libelle: "dont TVA", type: "fcfa", alignement: "droite" },
      { cle: "ht", libelle: "Total HT", type: "fcfa", alignement: "droite" },
    ],
    lignes: jours.map(([jour, j]) => [jour, j.ventes, j.avoirs, j.ttc, j.tva, j.ht]),
    totaux: ["Total", somme2(jours, "ventes"), somme2(jours, "avoirs"), somme(journal, "totalTtc"), somme(journal, "taxe"), somme(journal, "totalHt")],
    messageVide: MESSAGE_AUCUNE_VENTE,
  };
}

const somme2 = (jours: [string, { ventes: number; avoirs: number }][], champ: "ventes" | "avoirs") => jours.reduce((total, [, j]) => total + j[champ], 0);

function sectionDetail(journal: LigneJournalVentes[], limite: number): SectionEtat {
  const tronque = journal.length > limite;
  return {
    titre: "Détail facture par facture",
    colonnes: [
      { cle: "date", libelle: "Date", type: "date", alignement: "gauche" },
      { cle: "numero", libelle: "N°", type: "entier", alignement: "droite" },
      { cle: "type", libelle: "Type", type: "texte", alignement: "gauche", poids: 0.6 },
      { cle: "client", libelle: "Client", type: "texte", alignement: "gauche", poids: 1.3 },
      { cle: "detail", libelle: "Détail", type: "texte", alignement: "gauche", poids: 2 },
      { cle: "ttc", libelle: "Total TTC", type: "fcfa", alignement: "droite" },
      { cle: "encaisse", libelle: "Encaissé", type: "fcfa", alignement: "droite" },
      { cle: "reste", libelle: "Reste à payer", type: "fcfa", alignement: "droite" },
    ],
    lignes: journal.slice(0, limite).map((l) => [l.date, l.idFacture, l.type === "AVOIR" ? "Avoir" : "Vente", l.client, l.detail, l.totalTtc, l.encaisse, l.resteAPayer]),
    // le total d'un détail coupé tromperait : les totaux de la période (section dédiée) restent ceux de toutes les factures
    ...(tronque ? {} : { totaux: ["Total", "", "", "", "", somme(journal, "totalTtc"), somme(journal, "encaisse"), somme(journal, "resteAPayer")] }),
    messageVide: MESSAGE_AUCUNE_VENTE,
  };
}

function sectionTotaux(journal: LigneJournalVentes[]): SectionEtat {
  return {
    titre: "Totaux de la période",
    colonnes: [
      { cle: "libelle", libelle: "Libellé", type: "texte", alignement: "gauche" },
      { cle: "montant", libelle: "Montant", type: "fcfa", alignement: "droite" },
    ],
    lignes: [
      ["Total TTC (net des avoirs)", somme(journal, "totalTtc")],
      ["dont TVA", somme(journal, "taxe")],
      ["Total HT", somme(journal, "totalHt")],
      ["Reste à payer des ventes de la période", somme(journal, "resteAPayer")],
    ],
  };
}

export function construireEtatVentes(db: Db, siteId: number, periode: PeriodeExport, options: OptionsEtatVentes = {}): EtatImprimable {
  verifierPeriodeExport(periode);
  const limite = options.limiteDetail ?? LIMITE_DETAIL_PAR_DEFAUT;
  const { lignes: journal } = listerJournalVentes(db, siteId, periode);

  return {
    identifiant: "etat-des-ventes",
    titre: "État des ventes",
    periode: { du: periode.du, au: periode.au },
    entete: entete(db, siteId),
    genereLe: (options.maintenant ?? new Date()).toISOString(),
    sections: [sectionParJour(journal), sectionDetail(journal, limite), sectionTotaux(journal)],
    avertissements: journal.length > limite ? [`Détail limité aux ${espacerMilliers(limite)} premières factures : réduisez la période ou utilisez le CSV.`] : [],
  };
}
```

- [ ] **Étape 5 : constater le succès**

Run : `cd apps/api && npx tsc --noEmit -p . && npx vitest run src/modules/etats/etat-ventes.service.test.ts`
Attendu : `tsc` sans erreur, tous les tests du fichier passent.

- [ ] **Étape 6 : mise de côté (aucun commit sans ordre)**

Fichiers de la tâche : `apps/api/src/test-utils/fixture-etat-ventes.ts`, `apps/api/src/modules/etats/etat-ventes.service.ts`, `apps/api/src/modules/etats/etat-ventes.service.test.ts`.

---

### Tâche 5 : familles, modes de paiement, encaissé et recoupements

**Fichiers :**
- Modifier : `apps/api/src/modules/etats/etat-ventes.service.ts`
- Modifier : `apps/api/src/modules/etats/etat-ventes.service.test.ts`

**Interfaces :**
- Consomme : `facturesDeLaPeriode`, `paiementsDeLaPeriode`, `apercuExportComptable`, `exporterJournalVentesCsv` (tâche 3) ; `creerResolveurFamilleLigne` (tâche 3) ; le jeu de données de la tâche 4.
- Produit : l'état final à cinq sections plus les totaux : « Récapitulatif par jour », « Répartition par famille d'activité », « Répartition par mode de paiement », « Détail facture par facture », « Totaux de la période » (cinq lignes, « Encaissé sur la période » ajouté après « Total HT »).

Valeurs attendues sur novembre : familles CANAL+ 10 500, Produits & Services 7 900 (1 400 + 5 000 − 2 500 + 4 000), Netflix 3 500, SAV 3 000 (total 24 900) ; modes Espèces 10 400 (11 900 − 2 500 + 1 000), Chèque 5 000, Virement 2 000, Mobile Money 3 000 (total 20 400). Le solde de F2 (1 500 espèces le 01/12) tombe en décembre : l'encaissé de la période (20 400) diffère donc de la somme du détail (21 900), de 1 500.

- [ ] **Étape 1 : écrire les tests (ils échouent)**

Dans `etat-ventes.service.test.ts`, ajouter en tête de fichier, avec les autres imports :

```ts
import { apercuExportComptable, exporterJournalVentesCsv } from "../export-comptable/export-comptable.service.js";
```

Remplacer le test « la section des totaux vient en dernier » et le test « TTC net des avoirs, TVA, HT et reste à payer… » par :

```ts
  it("TTC net des avoirs, TVA, HT, encaissé sur la période et reste à payer des ventes de la période", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Totaux de la période");

    expect(s.lignes).toEqual([
      ["Total TTC (net des avoirs)", 24900],
      ["dont TVA", 1900],
      ["Total HT", 23000],
      ["Encaissé sur la période", 20400], // le solde de F2 (1 500 le 01/12) tombe en décembre
      ["Reste à payer des ventes de la période", 3000],
    ]);
  });

  it("les sections se suivent dans l'ordre de lecture, les totaux en dernier", () => {
    const titres = construireEtatVentes(db, fx.siteId, NOVEMBRE).sections.map((s) => s.titre);

    expect(titres).toEqual([
      "Récapitulatif par jour",
      "Répartition par famille d'activité",
      "Répartition par mode de paiement",
      "Détail facture par facture",
      "Totaux de la période",
    ]);
  });
```

Puis ajouter à la fin du fichier :

```ts
describe("construireEtatVentes : répartition par famille d'activité", () => {
  it("le chiffre d'affaires de chaque famille (même résolution que le tableau de bord), le plus gros d'abord, avoir déduit", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Répartition par famille d'activité");

    expect(s.colonnes.map((c) => c.libelle)).toEqual(["Famille", "Chiffre d'affaires TTC"]);
    expect(s.lignes).toEqual([
      ["CANAL+", 10500],
      ["Produits & Services", 7900], // 1 400 + 5 000 − 2 500 (avoir) + 4 000
      ["Netflix", 3500],
      ["SAV", 3000],
    ]);
    expect(s.totaux).toEqual(["Total", 24900]);
  });

  it("une période sans vente : le message et un total à zéro", () => {
    const s = section(construireEtatVentes(db, fx.siteId, { du: "2026-01-01", au: "2026-01-31" }).sections, "Répartition par famille d'activité");

    expect(s.lignes).toEqual([]);
    expect(s.messageVide).toBe("Aucune vente sur cette période");
    expect(s.totaux).toEqual(["Total", 0]);
  });
});

describe("construireEtatVentes : répartition par mode de paiement", () => {
  it("les paiements dont la date tombe dans la période, par mode, remboursement déduit ; les quatre modes toujours présents", () => {
    const s = section(construireEtatVentes(db, fx.siteId, NOVEMBRE).sections, "Répartition par mode de paiement");

    expect(s.colonnes.map((c) => c.libelle)).toEqual(["Mode de paiement", "Montant"]);
    expect(s.lignes).toEqual([
      ["Espèces", 10400], // 11 900 − 2 500 (remboursement) + 1 000 ; le solde de F2 (1 500, 01/12) est hors période
      ["Chèque", 5000],
      ["Virement", 2000],
      ["Mobile Money", 3000],
    ]);
    expect(s.totaux).toEqual(["Total", 20400]);
  });

  it("une période sans encaissement : les quatre modes à zéro", () => {
    const s = section(construireEtatVentes(db, fx.siteId, { du: "2026-01-01", au: "2026-01-31" }).sections, "Répartition par mode de paiement");

    expect(s.lignes).toEqual([["Espèces", 0], ["Chèque", 0], ["Virement", 0], ["Mobile Money", 0]]);
    expect(s.totaux).toEqual(["Total", 0]);
  });

  it("n'ajoute pas les paiements d'une autre boutique", () => {
    const s = section(construireEtatVentes(db, fx.autreSiteId, NOVEMBRE).sections, "Répartition par mode de paiement");

    expect(s.totaux).toEqual(["Total", 7777]);
  });
});

describe("construireEtatVentes : les sections se recoupent", () => {
  const valeurs = (s: SectionEtat, colonne: number) => s.lignes.map((l) => l[colonne] as number);
  const total = (nombres: number[]) => nombres.reduce((a, b) => a + b, 0);

  it("1. la somme des jours est celle des totaux de la période (TTC, TVA, HT)", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE);
    const jours = section(etat.sections, "Récapitulatif par jour");
    const totaux = section(etat.sections, "Totaux de la période");

    expect([total(valeurs(jours, 3)), total(valeurs(jours, 4)), total(valeurs(jours, 5))]).toEqual([totaux.lignes[0][1], totaux.lignes[1][1], totaux.lignes[2][1]]);
  });

  it("2. la somme des familles est le total TTC net de l'état, avoirs compris", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE);

    expect(total(valeurs(section(etat.sections, "Répartition par famille d'activité"), 1))).toBe(section(etat.sections, "Totaux de la période").lignes[0][1]);
  });

  it("3. la somme des modes de paiement est l'encaissé de l'aperçu de l'export comptable pour la même période", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE);
    const apercu = apercuExportComptable(db, fx.siteId, NOVEMBRE);

    expect(total(valeurs(section(etat.sections, "Répartition par mode de paiement"), 1))).toBe(apercu.encaissements.total);
    expect(section(etat.sections, "Totaux de la période").lignes[3][1]).toBe(apercu.encaissements.total);
    expect(section(etat.sections, "Totaux de la période").lignes[0][1]).toBe(apercu.ventes.totalTtc);
    expect(section(etat.sections, "Totaux de la période").lignes[1][1]).toBe(apercu.ventes.totalTva);
  });

  it("4. le détail porte autant de lignes que le journal CSV des ventes, et son total TTC est celui de l'état", () => {
    const etat = construireEtatVentes(db, fx.siteId, NOVEMBRE);
    const detail = section(etat.sections, "Détail facture par facture");

    expect(detail.lignes).toHaveLength(exporterJournalVentesCsv(db, fx.siteId, NOVEMBRE).nombre);
    expect(total(valeurs(detail, 5))).toBe(section(etat.sections, "Totaux de la période").lignes[0][1]);
  });
});
```

- [ ] **Étape 2 : constater l'échec**

Run : `cd apps/api && npx vitest run src/modules/etats/etat-ventes.service.test.ts`
Attendu : échecs sur les nouvelles sections (absentes) et sur l'ancienne forme des totaux.

- [ ] **Étape 3 : compléter le constructeur**

Dans `apps/api/src/modules/etats/etat-ventes.service.ts` :

1. Remplacer le bloc d'imports par :

```ts
import { eq, sql } from "drizzle-orm";
import { lignesContactBoutique, type EtatImprimable, type SectionEtat } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { trouverInfosEntrepriseParSite } from "../entreprise/entreprise.repository.js";
import {
  facturesDeLaPeriode,
  listerJournalVentes,
  paiementsDeLaPeriode,
  verifierPeriodeExport,
  type LigneJournalVentes,
  type PeriodeExport,
} from "../export-comptable/export-comptable.service.js";
import { creerResolveurFamilleLigne } from "../tableau-bord/tableau-bord.service.js";
```

2. Ajouter, après la fonction `sectionParJour`/`somme2` et avant `sectionDetail`, les deux nouvelles sections :

```ts
// Chiffre d'affaires par famille : même résolution que le tableau de bord (formule/kit/option → famille d'abonnement ; sinon Produits & Services, SAV).
// Les lignes d'avoir sont en négatif : la somme des familles est bien le total TTC net.
function sectionParFamille(db: Db, siteId: number, periode: PeriodeExport): SectionEtat {
  const lignes = db
    .select({ ligne: schema.ligneVente })
    .from(schema.ligneVente)
    .innerJoin(schema.facture, eq(schema.ligneVente.idFacture, schema.facture.idFacture))
    .where(facturesDeLaPeriode(db, siteId, periode))
    .all();
  const resoudreFamille = creerResolveurFamilleLigne(db);
  const parFamille = new Map<string, number>();
  for (const { ligne } of lignes) {
    const famille = resoudreFamille(ligne);
    parFamille.set(famille, (parFamille.get(famille) ?? 0) + ligne.prixApplique);
  }
  const triees = [...parFamille.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    titre: "Répartition par famille d'activité",
    colonnes: [
      { cle: "famille", libelle: "Famille", type: "texte", alignement: "gauche" },
      { cle: "montant", libelle: "Chiffre d'affaires TTC", type: "fcfa", alignement: "droite" },
    ],
    lignes: triees.map(([famille, montant]) => [famille, montant]),
    totaux: ["Total", triees.reduce((total, [, montant]) => total + montant, 0)],
    messageVide: MESSAGE_AUCUNE_VENTE,
  };
}

const LIBELLES_MODES = { CASH: "Espèces", CHEQUE: "Chèque", VIREMENT: "Virement", MOBILE_MONEY: "Mobile Money" } as const;

// Encaissements de la période par mode, sur la date de chaque paiement (un acompte et son solde tombent chacun dans leur mois) ; un remboursement
// est en négatif. Les quatre modes figurent toujours, à zéro s'il n'y a rien.
function sectionParMode(db: Db, siteId: number, periode: PeriodeExport): { section: SectionEtat; total: number } {
  const paiements = db
    .select({ mode: schema.paiement.mode, total: sql<number>`sum(${schema.paiement.montant})` })
    .from(schema.paiement)
    .innerJoin(schema.facture, eq(schema.paiement.idFacture, schema.facture.idFacture))
    .where(paiementsDeLaPeriode(siteId, periode))
    .groupBy(schema.paiement.mode)
    .all();
  const parMode = new Map(paiements.map((p) => [p.mode, p.total]));
  const lignes = (Object.keys(LIBELLES_MODES) as (keyof typeof LIBELLES_MODES)[]).map((mode): [string, number] => [LIBELLES_MODES[mode], parMode.get(mode) ?? 0]);
  const total = lignes.reduce((somme, [, montant]) => somme + montant, 0);
  return {
    total,
    section: {
      titre: "Répartition par mode de paiement",
      colonnes: [
        { cle: "mode", libelle: "Mode de paiement", type: "texte", alignement: "gauche" },
        { cle: "montant", libelle: "Montant", type: "fcfa", alignement: "droite" },
      ],
      lignes,
      totaux: ["Total", total],
    },
  };
}
```

3. Remplacer la fonction `sectionTotaux` par :

```ts
function sectionTotaux(journal: LigneJournalVentes[], encaisseSurLaPeriode: number): SectionEtat {
  return {
    titre: "Totaux de la période",
    colonnes: [
      { cle: "libelle", libelle: "Libellé", type: "texte", alignement: "gauche" },
      { cle: "montant", libelle: "Montant", type: "fcfa", alignement: "droite" },
    ],
    lignes: [
      ["Total TTC (net des avoirs)", somme(journal, "totalTtc")],
      ["dont TVA", somme(journal, "taxe")],
      ["Total HT", somme(journal, "totalHt")],
      // somme des paiements de la période (par date de paiement) ; le « reste à payer » ci-dessous est, lui, celui d'aujourd'hui sur ces ventes
      ["Encaissé sur la période", encaisseSurLaPeriode],
      ["Reste à payer des ventes de la période", somme(journal, "resteAPayer")],
    ],
  };
}
```

4. Dans `construireEtatVentes`, remplacer la déclaration `const { lignes: journal } = …` et le `return` par :

```ts
  const { lignes: journal } = listerJournalVentes(db, siteId, periode);
  const modes = sectionParMode(db, siteId, periode);

  return {
    identifiant: "etat-des-ventes",
    titre: "État des ventes",
    periode: { du: periode.du, au: periode.au },
    entete: entete(db, siteId),
    genereLe: (options.maintenant ?? new Date()).toISOString(),
    sections: [sectionParJour(journal), sectionParFamille(db, siteId, periode), modes.section, sectionDetail(journal, limite), sectionTotaux(journal, modes.total)],
    avertissements: journal.length > limite ? [`Détail limité aux ${espacerMilliers(limite)} premières factures : réduisez la période ou utilisez le CSV.`] : [],
  };
```

- [ ] **Étape 4 : constater le succès**

Run : `cd apps/api && npx tsc --noEmit -p . && npx vitest run src/modules/etats src/modules/export-comptable src/modules/tableau-bord`
Attendu : `tsc` sans erreur ; tous les tests passent (états, export comptable, tableau de bord).

- [ ] **Étape 5 : mise de côté (aucun commit sans ordre)**

Fichiers de la tâche : `apps/api/src/modules/etats/etat-ventes.service.ts`, `apps/api/src/modules/etats/etat-ventes.service.test.ts`.

---

### Tâche 6 : le rendu PDF

**Fichiers :**
- Modifier : `apps/api/package.json`, `package-lock.json` (racine)
- Créer : `apps/api/src/modules/etats/etat-pdf.ts`
- Créer : `apps/api/src/modules/etats/etat-pdf.test.ts`

**Interfaces :**
- Consomme : `EtatImprimable`, `ColonneEtat`, `formaterValeurEtat`, `libellePeriodeEtat`, `dateHeureDouala` (tâche 1).
- Produit : `texteCompatiblePdf(texte: string): string` ; `rendreEtatPdf(etat: EtatImprimable, options?: { compresser?: boolean }): Promise<Buffer>`.

- [ ] **Étape 1 : installer la dépendance**

Run (à la racine du dépôt) : `npm install pdfkit@0.20.2 --workspace=apps/api && npm install -D @types/pdfkit@0.17.7 --workspace=apps/api`
Attendu : `pdfkit` apparaît dans `dependencies` et `@types/pdfkit` dans `devDependencies` de `apps/api/package.json` ; `package-lock.json` mis à jour. Le lanceur Windows réinstalle seul les composants quand `package-lock.json` est plus récent que `node_modules`.

- [ ] **Étape 2 : écrire les tests (ils échouent)**

Créer `apps/api/src/modules/etats/etat-pdf.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import type { EtatImprimable } from "@mboapilot/shared";
import { rendreEtatPdf, texteCompatiblePdf } from "./etat-pdf.js";

// pdfkit écrit le texte en hexadécimal dans des opérateurs Tj / TJ, en octets Windows-1252 : on le relit pour vérifier ce qui est réellement dessiné
function textesDuPdf(pdf: Buffer): string[] {
  const decodeur = new TextDecoder("windows-1252");
  const sortie: string[] = [];
  for (const ligne of pdf.toString("latin1").split(/\r?\n/)) {
    if (!/(Tj|TJ)\s*$/.test(ligne)) continue;
    let texte = "";
    for (const h of ligne.matchAll(/<([0-9a-fA-F]+)>/g)) texte += decodeur.decode(Buffer.from(h[1], "hex"));
    sortie.push(texte);
  }
  return sortie;
}
const toutLeTexte = (pdf: Buffer) => textesDuPdf(pdf).join("\n");
const nombreDePages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

function etat(surcharges: Partial<EtatImprimable> = {}): EtatImprimable {
  return {
    identifiant: "etat-des-ventes",
    titre: "État des ventes",
    periode: { du: "2026-11-01", au: "2026-11-17" },
    entete: { nomBoutique: "Boutique Démo", lignesContact: ["Douala — Akwa", "Tél : 677 00 00 00"] },
    genereLe: "2026-11-17T14:21:00.000Z",
    sections: [
      {
        titre: "Récapitulatif par jour",
        colonnes: [
          { cle: "jour", libelle: "Jour", type: "date", alignement: "gauche" },
          { cle: "produit", libelle: "Article", type: "texte", alignement: "gauche" },
          { cle: "ttc", libelle: "Total TTC", type: "fcfa", alignement: "droite" },
        ],
        lignes: [
          ["2026-11-16", "Câble HDMI", 12500],
          ["2026-11-17", "Décodeur", -2500],
        ],
        totaux: ["Total", "", 10000],
      },
    ],
    avertissements: [],
    ...surcharges,
  };
}

const sansCompression = { compresser: false };

describe("texteCompatiblePdf : seul le jeu de caractères de la police standard (Windows-1252) passe", () => {
  it("garde les accents, l'apostrophe typographique, le tiret long, le point médian et la croix de multiplication", () => {
    expect(texteCompatiblePdf("Câble HDMI — Réabonnement n° 5 × 2 · l’état")).toBe("Câble HDMI — Réabonnement n° 5 × 2 · l’état");
  });

  it("ramène les espaces insécables (dont l'espace fine des nombres français) à une espace simple", () => {
    expect(texteCompatiblePdf("12\u202f500\u00a0FCFA")).toBe("12 500 FCFA");
  });

  it("remplace par « ? » ce que la police ne sait pas écrire, au lieu de produire un caractère cassé", () => {
    expect(texteCompatiblePdf("a→b ★")).toBe("a?b ?");
  });

  it("remplace les retours à la ligne par une espace : une cellule tient sur sa ligne", () => {
    expect(texteCompatiblePdf("ligne 1\nligne 2")).toBe("ligne 1 ligne 2");
  });
});

describe("rendreEtatPdf", () => {
  it("produit un vrai fichier PDF d'une page", async () => {
    const pdf = await rendreEtatPdf(etat(), sansCompression);

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1").trimEnd().endsWith("%%EOF")).toBe(true);
    expect(nombreDePages(pdf)).toBe(1);
  });

  it("dessine l'en-tête de la boutique, le titre, la période et la date de génération (heure de Douala)", async () => {
    const texte = toutLeTexte(await rendreEtatPdf(etat(), sansCompression));

    for (const attendu of ["Boutique Démo", "Douala — Akwa", "Tél : 677 00 00 00", "État des ventes", "Période : du 01/11/2026 au 17/11/2026", "Généré le 17/11/2026 15:21"]) {
      expect(texte).toContain(attendu);
    }
  });

  it("dessine le titre de la section, les titres de colonnes, les dates en JJ/MM/AAAA, les montants groupés par milliers et les totaux", async () => {
    const texte = toutLeTexte(await rendreEtatPdf(etat(), sansCompression));

    for (const attendu of ["Récapitulatif par jour", "Total TTC", "16/11/2026", "Câble HDMI", "12 500", "-2 500", "Total", "10 000"]) {
      expect(texte).toContain(attendu);
    }
  });

  it("n'écrit aucune espace insécable (la police ne l'a pas) ni point d'interrogation à la place d'un accent", async () => {
    const texte = toutLeTexte(await rendreEtatPdf(etat(), sansCompression));

    expect(texte).not.toMatch(/[\u00a0\u202f]/);
    expect(texte).not.toContain("C?ble");
    expect(texte).not.toContain("?tat");
  });

  it("une section sans ligne montre son message", async () => {
    const vide = etat({ sections: [{ titre: "Détail", colonnes: [{ cle: "a", libelle: "A", type: "texte", alignement: "gauche" }], lignes: [], messageVide: "Aucune vente sur cette période" }] });

    expect(toutLeTexte(await rendreEtatPdf(vide, sansCompression))).toContain("Aucune vente sur cette période");
  });

  it("montre les avertissements sous l'en-tête", async () => {
    const texte = toutLeTexte(await rendreEtatPdf(etat({ avertissements: ["Détail limité aux 2 premières factures : réduisez la période ou utilisez le CSV."] }), sansCompression));

    expect(texte).toContain("Attention : Détail limité aux 2 premières factures");
  });

  it("une cellule de texte très longue passe à la ligne sans rien perdre ni déborder sur une autre page", async () => {
    const long = "mot ".repeat(120).trim();
    const pdf = await rendreEtatPdf(etat({ sections: [{ titre: "Détail", colonnes: [{ cle: "d", libelle: "Détail", type: "texte", alignement: "gauche" }], lignes: [[long]] }] }), sansCompression);

    expect(nombreDePages(pdf)).toBe(1);
    expect(toutLeTexte(pdf).replace(/\s+/g, " ").match(/mot/g)).toHaveLength(120);
  });

  it("un long tableau passe sur plusieurs pages : titres de colonnes répétés, « Page i / n » en pied, aucune ligne perdue", async () => {
    const lignes = Array.from({ length: 200 }, (_, i) => [`2026-11-${String((i % 28) + 1).padStart(2, "0")}`, `Article ${i + 1}`, 1000 + i]);
    const pdf = await rendreEtatPdf(etat({ sections: [{ ...etat().sections[0], lignes, totaux: undefined }] }), sansCompression);
    const pages = nombreDePages(pdf);
    const texte = toutLeTexte(pdf);

    expect(pages).toBeGreaterThanOrEqual(4);
    expect((texte.match(/Total TTC/g) ?? []).length).toBeGreaterThanOrEqual(pages); // l'en-tête du tableau reparaît à chaque page
    expect(texte).toContain(`Page 1 / ${pages}`);
    expect(texte).toContain(`Page ${pages} / ${pages}`);
    expect(texte).toContain("Article 1");
    expect(texte).toContain("Article 200");
    expect((texte.match(/Article \d+/g) ?? []).length).toBe(200);
  });

  it("compressé par défaut : plus petit que la version lisible, et toujours un PDF valide de même nombre de pages", async () => {
    const lignes = Array.from({ length: 80 }, (_, i) => ["2026-11-03", `Article ${i}`, i]);
    const grand = etat({ sections: [{ ...etat().sections[0], lignes, totaux: undefined }] });
    const compresse = await rendreEtatPdf(grand);
    const lisible = await rendreEtatPdf(grand, sansCompression);

    expect(compresse.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(compresse.length).toBeLessThan(lisible.length);
    expect(nombreDePages(compresse)).toBe(nombreDePages(lisible));
  });

  it("des caractères hors jeu dans les données ne font pas échouer la génération", async () => {
    const pdf = await rendreEtatPdf(etat({ entete: { nomBoutique: "Boutique ★ Démo", lignesContact: [] } }), sansCompression);

    expect(toutLeTexte(pdf)).toContain("Boutique ? Démo");
  });
});
```

- [ ] **Étape 3 : constater l'échec**

Run : `cd apps/api && npx vitest run src/modules/etats/etat-pdf.test.ts`
Attendu : échec, le module `etat-pdf.js` n'existe pas.

- [ ] **Étape 4 : écrire le rendu**

Créer `apps/api/src/modules/etats/etat-pdf.ts` :

```ts
import PDFDocument from "pdfkit";
import { dateHeureDouala, formaterValeurEtat, libellePeriodeEtat, type ColonneEtat, type EtatImprimable, type SectionEtat } from "@mboapilot/shared";

// Rendu PDF d'un état : A4 portrait, police standard Helvetica (accents français gérés), tableaux dont l'en-tête reparaît à chaque page, « Page i / n »
// en pied. Aucun composant natif, aucun navigateur : le fichier est fabriqué par le serveur, sans Internet.

const LARGEUR_PAGE = 595.28;
const HAUTEUR_PAGE = 841.89;
const MARGE = 40;
const LARGEUR_UTILE = LARGEUR_PAGE - 2 * MARGE;
// au-delà de cette ordonnée : saut de page (le bas de la page est réservé au pied de page)
const Y_MAX = HAUTEUR_PAGE - MARGE - 14;
const MARGE_CELLULE = 3;
const TAILLE_TEXTE = 8.5;
const LARGEURS_FIXES = { date: 58, entier: 44, fcfa: 72 } as const;
const POLICE = "Helvetica";
const POLICE_GRAS = "Helvetica-Bold";
const POLICE_ITALIQUE = "Helvetica-Oblique";

// Les caractères de la police standard hors ASCII et Latin-1 : le jeu « Windows-1252 » (guillemets typographiques, tirets, point médian, ‰, œ…)
const AUTRES_WIN_ANSI = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013,
  0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

// Ce que la police ne sait pas écrire devient « ? » plutôt qu'un caractère cassé ; les espaces insécables (dont l'espace fine des nombres français, que
// la police n'a pas) deviennent des espaces simples ; une cellule tient sur sa ligne.
export function texteCompatiblePdf(texte: string): string {
  return Array.from(texte.replace(/[\u00a0\u2007\u2009\u202f]/g, " ").replace(/[\r\n]+/g, " "))
    .map((caractere) => {
      const point = caractere.codePointAt(0) ?? 0;
      return (point >= 0x20 && point <= 0x7e) || (point >= 0xa1 && point <= 0xff) || AUTRES_WIN_ANSI.has(point) ? caractere : "?";
    })
    .join("");
}

function largeursColonnes(colonnes: ColonneEtat[]): number[] {
  const fixe = colonnes.reduce((total, c) => total + (c.type === "texte" ? 0 : LARGEURS_FIXES[c.type]), 0);
  const poidsTotal = colonnes.reduce((total, c) => total + (c.type === "texte" ? (c.poids ?? 1) : 0), 0);
  const reste = Math.max(LARGEUR_UTILE - fixe, 0);
  return colonnes.map((c) => (c.type === "texte" ? (reste * (c.poids ?? 1)) / poidsTotal : LARGEURS_FIXES[c.type]));
}

type StyleLigne = "entete" | "normale" | "total";
const policeDe = (style: StyleLigne) => (style === "normale" ? POLICE : POLICE_GRAS);

function hauteurLigne(doc: PDFKit.PDFDocument, cellules: string[], largeurs: number[], style: StyleLigne): number {
  doc.font(policeDe(style)).fontSize(TAILLE_TEXTE);
  const hauteurs = cellules.map((texte, i) => doc.heightOfString(texte, { width: largeurs[i] - 2 * MARGE_CELLULE }));
  return Math.max(...hauteurs, TAILLE_TEXTE) + 2 * MARGE_CELLULE;
}

// dessine une ligne de tableau à l'ordonnée y et renvoie l'ordonnée suivante
function dessinerLigne(doc: PDFKit.PDFDocument, cellules: string[], colonnes: ColonneEtat[], largeurs: number[], y: number, style: StyleLigne): number {
  const hauteur = hauteurLigne(doc, cellules, largeurs, style);
  if (style === "entete") doc.rect(MARGE, y, LARGEUR_UTILE, hauteur).fill("#e8e8e8");
  doc.fillColor("#000000").font(policeDe(style)).fontSize(TAILLE_TEXTE);
  let x = MARGE;
  cellules.forEach((texte, i) => {
    doc.text(texte, x + MARGE_CELLULE, y + MARGE_CELLULE, { width: largeurs[i] - 2 * MARGE_CELLULE, align: colonnes[i].alignement === "droite" ? "right" : "left" });
    x += largeurs[i];
  });
  const epaisseur = style === "total" ? 1 : 0.4;
  doc.moveTo(MARGE, y + hauteur).lineTo(MARGE + LARGEUR_UTILE, y + hauteur).lineWidth(epaisseur).strokeColor(style === "total" ? "#000000" : "#bbbbbb").stroke();
  return y + hauteur;
}

function dessinerEntete(doc: PDFKit.PDFDocument, etat: EtatImprimable): number {
  let y = MARGE;
  doc.font(POLICE_GRAS).fontSize(14).fillColor("#000000").text(texteCompatiblePdf(etat.entete.nomBoutique), MARGE, y, { width: LARGEUR_UTILE });
  y = doc.y;
  doc.font(POLICE).fontSize(TAILLE_TEXTE).fillColor("#333333");
  for (const ligne of etat.entete.lignesContact) {
    doc.text(texteCompatiblePdf(ligne), MARGE, y, { width: LARGEUR_UTILE });
    y = doc.y;
  }
  y += 10;
  doc.font(POLICE_GRAS).fontSize(16).fillColor("#000000").text(texteCompatiblePdf(etat.titre), MARGE, y, { width: LARGEUR_UTILE });
  y = doc.y + 2;
  doc.font(POLICE).fontSize(10).text(texteCompatiblePdf(`Période : ${libellePeriodeEtat(etat.periode)}`), MARGE, y, { width: LARGEUR_UTILE });
  y = doc.y + 2;
  doc.fontSize(TAILLE_TEXTE).fillColor("#555555").text(texteCompatiblePdf(`Généré le ${dateHeureDouala(etat.genereLe)}`), MARGE, y, { width: LARGEUR_UTILE });
  y = doc.y + 6;
  for (const avertissement of etat.avertissements) {
    doc.font(POLICE_GRAS).fontSize(9).fillColor("#8a1c1c").text(texteCompatiblePdf(`Attention : ${avertissement}`), MARGE, y, { width: LARGEUR_UTILE });
    y = doc.y + 2;
  }
  return y + 10;
}

function dessinerSection(doc: PDFKit.PDFDocument, section: SectionEtat, yDepart: number): number {
  const { colonnes } = section;
  const largeurs = largeursColonnes(colonnes);
  const libelles = colonnes.map((c) => texteCompatiblePdf(c.libelle));
  const cellulesDe = (ligne: (string | number)[]) => ligne.map((valeur, i) => texteCompatiblePdf(formaterValeurEtat(valeur, colonnes[i].type)));
  let y = yDepart;

  // le titre et l'en-tête du tableau ne restent jamais seuls en bas de page : il faut la place d'au moins une ligne en dessous
  if (y + 18 + hauteurLigne(doc, libelles, largeurs, "entete") + 22 > Y_MAX) {
    doc.addPage();
    y = MARGE;
  }
  doc.font(POLICE_GRAS).fontSize(10.5).fillColor("#000000").text(texteCompatiblePdf(section.titre), MARGE, y, { width: LARGEUR_UTILE });
  y += 18;
  y = dessinerLigne(doc, libelles, colonnes, largeurs, y, "entete");

  const nouvellePage = (): number => {
    doc.addPage();
    return dessinerLigne(doc, libelles, colonnes, largeurs, MARGE, "entete");
  };

  if (section.lignes.length === 0) {
    doc.font(POLICE_ITALIQUE).fontSize(TAILLE_TEXTE).fillColor("#444444").text(texteCompatiblePdf(section.messageVide ?? "Aucune donnée"), MARGE + MARGE_CELLULE, y + MARGE_CELLULE, { width: LARGEUR_UTILE });
    y += 18;
  }
  for (const ligne of section.lignes) {
    const cellules = cellulesDe(ligne);
    if (y + hauteurLigne(doc, cellules, largeurs, "normale") > Y_MAX) y = nouvellePage();
    y = dessinerLigne(doc, cellules, colonnes, largeurs, y, "normale");
  }
  if (section.totaux) {
    const cellules = cellulesDe(section.totaux);
    if (y + hauteurLigne(doc, cellules, largeurs, "total") > Y_MAX) y = nouvellePage();
    y = dessinerLigne(doc, cellules, colonnes, largeurs, y, "total");
  }
  return y + 16;
}

export async function rendreEtatPdf(etat: EtatImprimable, options: { compresser?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGE,
    bufferPages: true,
    compress: options.compresser !== false,
    info: { Title: etat.titre, Author: "MboaPilot", Subject: `${etat.entete.nomBoutique} — ${libellePeriodeEtat(etat.periode)}` },
  });
  const morceaux: Buffer[] = [];
  doc.on("data", (morceau: Buffer) => morceaux.push(morceau));
  const termine = new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  let y = dessinerEntete(doc, etat);
  for (const section of etat.sections) y = dessinerSection(doc, section, y);

  // pied de page, une fois le nombre de pages connu ; la marge basse est annulée le temps de l'écrire, sinon pdfkit ajouterait une page
  const { start, count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    doc.page.margins.bottom = 0;
    doc.font(POLICE).fontSize(8).fillColor("#666666").text(texteCompatiblePdf(`${etat.titre} — Page ${i + 1} / ${count}`), MARGE, HAUTEUR_PAGE - MARGE + 6, {
      width: LARGEUR_UTILE,
      align: "right",
      lineBreak: false,
    });
  }

  doc.end();
  await termine;
  return Buffer.concat(morceaux);
}
```

- [ ] **Étape 5 : constater le succès**

Run : `cd apps/api && npx tsc --noEmit -p . && npx vitest run src/modules/etats/etat-pdf.test.ts`
Attendu : `tsc` sans erreur (si `PDFKit.PDFDocument` n'est pas reconnu comme type global, importer le type avec `import type PDFKit from "pdfkit"` et utiliser `PDFKit.PDFDocument`) ; tous les tests passent.

- [ ] **Étape 6 : mise de côté (aucun commit sans ordre)**

Fichiers de la tâche : `apps/api/package.json`, `package-lock.json`, `apps/api/src/modules/etats/etat-pdf.ts`, `apps/api/src/modules/etats/etat-pdf.test.ts`.

---

### Tâche 7 : les routes JSON, CSV et PDF

**Fichiers :**
- Créer : `apps/api/src/modules/etats/etats.routes.ts`
- Créer : `apps/api/src/modules/etats/etats.routes.test.ts`
- Modifier : `apps/api/src/app.ts`

**Interfaces :**
- Consomme : `construireEtatVentes` (tâches 4-5), `rendreEtatPdf` (tâche 6), `etatVersCsv`, `nomFichierEtat` (tâche 1), `PeriodeExport` (export comptable), `envoyerErreur` (`lib/erreurs-api.js`), la garde `pilotage`.
- Produit : `registerEtatsRoutes(app, db, guards: { authRequis: Guard; pilotage: Guard })` ; les routes `GET /api/v1/etats/ventes`, `/api/v1/etats/ventes/csv`, `/api/v1/etats/ventes/pdf`, avec les paramètres `du` et `au`.

- [ ] **Étape 1 : écrire les tests (ils échouent)**

Créer `apps/api/src/modules/etats/etats.routes.test.ts` :

```ts
import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerFixtureEtatVentes, type FixtureEtatVentes } from "../../test-utils/fixture-etat-ventes.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";

const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";
const MOT_DE_PASSE = "motdepasse-secret";
const QUERY = "du=2026-11-01&au=2026-11-30";
const ROUTES = ["/api/v1/etats/ventes", "/api/v1/etats/ventes/csv", "/api/v1/etats/ventes/pdf"];

let db: Db;
let app: FastifyInstance;
let fx: FixtureEtatVentes;
const jetons: Record<string, string> = {};

async function connecter(identifiant: string): Promise<string> {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse: MOT_DE_PASSE } });
  return reponse.json().token as string;
}
const get = (url: string, role?: string) => app.inject({ method: "GET", url, headers: role ? { authorization: `Bearer ${jetons[role]}` } : {} });

beforeAll(async () => {
  db = creerDbTest();
  fx = creerFixtureEtatVentes(db);
  for (const role of ["ADMINISTRATEUR", "GERANT", "COMPTABLE", "CAISSIER", "TECHNICIEN_SAV", "APPORTEUR"] as const) {
    creerUtilisateur(db, { siteId: fx.siteId, nom: role, prenom: "Test", identifiant: role.toLowerCase(), motDePasse: MOT_DE_PASSE, role });
  }
  creerUtilisateur(db, { siteId: fx.autreSiteId, nom: "Gerant", prenom: "Site B", identifiant: "gerant.b", motDePasse: MOT_DE_PASSE, role: "GERANT" });
  app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
  for (const role of ["ADMINISTRATEUR", "GERANT", "COMPTABLE", "CAISSIER", "TECHNICIEN_SAV", "APPORTEUR"]) jetons[role] = await connecter(role.toLowerCase());
  jetons["GERANT_B"] = await connecter("gerant.b");
}, 120_000);

describe("droits : le pilotage financier (Administrateur, Gérant, Comptable) et personne d'autre", () => {
  for (const role of ["ADMINISTRATEUR", "GERANT", "COMPTABLE"]) {
    it(`${role} reçoit l'état sous les trois formes (200)`, async () => {
      for (const route of ROUTES) expect((await get(`${route}?${QUERY}`, role)).statusCode, `${route} pour ${role}`).toBe(200);
    });
  }

  for (const role of ["CAISSIER", "TECHNICIEN_SAV", "APPORTEUR"]) {
    it(`${role} est refusé (403) sur les trois routes`, async () => {
      for (const route of ROUTES) expect((await get(`${route}?${QUERY}`, role)).statusCode, `${route} pour ${role}`).toBe(403);
    });
  }

  it("sans compte : 401 sur les trois routes", async () => {
    for (const route of ROUTES) expect((await get(`${route}?${QUERY}`)).statusCode, route).toBe(401);
  });
});

describe("GET /api/v1/etats/ventes (JSON)", () => {
  it("renvoie l'état complet de la période", async () => {
    const etat = (await get(`/api/v1/etats/ventes?${QUERY}`, "GERANT")).json();

    expect(etat.titre).toBe("État des ventes");
    expect(etat.periode).toEqual({ du: "2026-11-01", au: "2026-11-30" });
    expect(etat.sections.map((s: { titre: string }) => s.titre)).toEqual([
      "Récapitulatif par jour",
      "Répartition par famille d'activité",
      "Répartition par mode de paiement",
      "Détail facture par facture",
      "Totaux de la période",
    ]);
    expect(etat.sections[4].lignes[0]).toEqual(["Total TTC (net des avoirs)", 24900]);
  });

  it("refuse une période absente, invalide, inversée ou trop longue (400) avec un message clair", async () => {
    const message = async (requete: string) => {
      const reponse = await get(`/api/v1/etats/ventes${requete}`, "GERANT");
      expect(reponse.statusCode, requete).toBe(400);
      return reponse.json().erreur as string;
    };

    expect(await message("")).toMatch(/date de début/);
    expect(await message("?du=2026-02-30&au=2026-03-01")).toMatch(/date de début/);
    expect(await message("?du=2026-11-30&au=2026-11-01")).toMatch(/inversée/);
    expect(await message("?du=2025-01-01&au=2026-11-30")).toMatch(/trop longue/);
  });

  it("une période sans vente est un état valide, pas une erreur", async () => {
    const reponse = await get("/api/v1/etats/ventes?du=2026-01-01&au=2026-01-31", "COMPTABLE");

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().sections[0].lignes).toEqual([]);
  });

  it("la boutique est celle de la session : un siteId dans l'adresse est ignoré", async () => {
    const parSite = async (role: string, supplement: string) =>
      (await get(`/api/v1/etats/ventes?${QUERY}${supplement}`, role)).json().sections[4].lignes[0] as [string, number];

    expect(await parSite("GERANT", "")).toEqual(["Total TTC (net des avoirs)", 24900]);
    expect(await parSite("GERANT_B", "")).toEqual(["Total TTC (net des avoirs)", 7777]);
    expect(await parSite("GERANT_B", `&siteId=${fx.siteId}`)).toEqual(["Total TTC (net des avoirs)", 7777]); // jamais les ventes de la boutique A
  });
});

describe("GET /api/v1/etats/ventes/csv", () => {
  it("renvoie un CSV nommé d'après la période, avec le titre et les totaux", async () => {
    const reponse = await get(`/api/v1/etats/ventes/csv?${QUERY}`, "GERANT");

    expect(reponse.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(reponse.headers["content-disposition"]).toBe("attachment; filename=etat-des-ventes-2026-11-01-au-2026-11-30.csv");
    const lignes = reponse.body.split("\r\n");
    expect(lignes[0]).toBe("État des ventes");
    expect(lignes[1]).toBe("Période;du 01/11/2026 au 30/11/2026");
    expect(lignes).toContain("Total TTC (net des avoirs);24900");
  });

  it("une période invalide donne 400 et son message, pas un fichier", async () => {
    const reponse = await get("/api/v1/etats/ventes/csv?du=2026-11-30&au=2026-11-01", "GERANT");

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().erreur).toMatch(/inversée/);
  });
});

describe("GET /api/v1/etats/ventes/pdf", () => {
  it("renvoie un vrai PDF nommé d'après la période", async () => {
    const reponse = await get(`/api/v1/etats/ventes/pdf?${QUERY}`, "COMPTABLE");

    expect(reponse.headers["content-type"]).toBe("application/pdf");
    expect(reponse.headers["content-disposition"]).toBe("attachment; filename=etat-des-ventes-2026-11-01-au-2026-11-30.pdf");
    expect(reponse.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(reponse.rawPayload.length).toBeGreaterThan(1000);
  });

  it("une période invalide donne 400 et son message, pas un fichier", async () => {
    const reponse = await get("/api/v1/etats/ventes/pdf?du=2025-01-01&au=2026-11-30", "GERANT");

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().erreur).toMatch(/trop longue/);
  });
});
```

- [ ] **Étape 2 : constater l'échec**

Run : `cd apps/api && npx vitest run src/modules/etats/etats.routes.test.ts`
Attendu : échec, les routes n'existent pas (404 au lieu de 200 / 403).

- [ ] **Étape 3 : écrire les routes et les enregistrer**

Créer `apps/api/src/modules/etats/etats.routes.ts` :

```ts
import type { FastifyInstance } from "fastify";
import { etatVersCsv, nomFichierEtat } from "@mboapilot/shared";
import type { Db } from "../../db/types.js";
import type { Guard } from "../auth/auth.plugin.js";
import { envoyerErreur } from "../../lib/erreurs-api.js";
import type { PeriodeExport } from "../export-comptable/export-comptable.service.js";
import { construireEtatVentes } from "./etat-ventes.service.js";
import { rendreEtatPdf } from "./etat-pdf.js";

type Requete = { Querystring: { du?: string; au?: string } };

// États de gestion : l'administration, la gérance et le comptable (comme le pilotage financier et l'export comptable). La boutique est celle de la
// session : une requête ne désigne jamais celle d'une autre, et un éventuel siteId dans l'adresse est ignoré.
export function registerEtatsRoutes(app: FastifyInstance, db: Db, guards: { authRequis: Guard; pilotage: Guard }) {
  const preHandler = [guards.authRequis, guards.pilotage];
  const periode = (q: Requete["Querystring"]) => ({ du: q.du, au: q.au }) as PeriodeExport;

  app.get<Requete>("/api/v1/etats/ventes", { preHandler }, async (request, reply) => {
    try {
      reply.code(200).send(construireEtatVentes(db, request.user.siteId, periode(request.query)));
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });

  app.get<Requete>("/api/v1/etats/ventes/csv", { preHandler }, async (request, reply) => {
    try {
      const etat = construireEtatVentes(db, request.user.siteId, periode(request.query));
      reply
        .code(200)
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename=${nomFichierEtat(etat, "csv")}`)
        .send(etatVersCsv(etat));
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });

  app.get<Requete>("/api/v1/etats/ventes/pdf", { preHandler }, async (request, reply) => {
    try {
      const etat = construireEtatVentes(db, request.user.siteId, periode(request.query));
      const pdf = await rendreEtatPdf(etat);
      reply
        .code(200)
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename=${nomFichierEtat(etat, "pdf")}`)
        .send(pdf);
    } catch (erreur) {
      envoyerErreur(reply, erreur);
    }
  });
}
```

Dans `apps/api/src/app.ts` :

1. Ajouter après la ligne `import { registerExportComptableRoutes } from "./modules/export-comptable/export-comptable.routes.js";` :

```ts
import { registerEtatsRoutes } from "./modules/etats/etats.routes.js";
```

2. Ajouter après la ligne `registerExportComptableRoutes(app, db, { authRequis, pilotage });` :

```ts
  // états de gestion imprimables (état des ventes) : écran, CSV, PDF — mêmes rôles que le pilotage financier
  registerEtatsRoutes(app, db, { authRequis, pilotage });
```

- [ ] **Étape 4 : constater le succès**

Run : `cd apps/api && npx tsc --noEmit -p . && npx vitest run src/modules/etats`
Attendu : `tsc` sans erreur ; tous les tests des états (service, PDF, routes) passent.

- [ ] **Étape 5 : mise de côté (aucun commit sans ordre)**

Fichiers de la tâche : `apps/api/src/modules/etats/etats.routes.ts`, `apps/api/src/modules/etats/etats.routes.test.ts`, `apps/api/src/app.ts`.

---

### Tâche 8 : l'écran « États » (interface)

L'interface n'a pas de tests unitaires dans ce projet : la garantie est le typage strict, puis la vérification dans le navigateur de la tâche 9. Les règles de calcul, elles, sont couvertes côté serveur.

**Fichiers :**
- Modifier : `apps/web/src/lib/api.ts`
- Créer : `apps/web/src/components/etats/EtatImprime.tsx`
- Créer : `apps/web/src/components/etats/EtatsPage.tsx`
- Modifier : `apps/web/src/components/layout/AppHeader.tsx`, `apps/web/src/App.tsx`

**Interfaces :**
- Consomme : `EtatImprimable`, `SectionEtat`, `formaterValeurEtat`, `libellePeriodeEtat`, `dateHeureDouala`, `nomFichierEtat`, `raccourcisPeriode`, `jourDouala`, la vue `"etats"` (code partagé) ; les routes de la tâche 7 ; `ErreurAuthentification`, `appelerServeur`, `headersAuth`, `lireErreurExport` (privées à `api.ts`, utilisables depuis le même fichier).
- Produit : `chargerEtatVentes(token, du, au): Promise<EtatImprimable>` ; `telechargerEtatVentes(token, format: "pdf" | "csv", du, au): Promise<{ blob: Blob; nomFichier: string }>` ; les composants `EtatImprime` et `EtatsPage`.

- [ ] **Étape 1 : les appels serveur**

Dans `apps/web/src/lib/api.ts`, ajouter l'import de type en tête du fichier, avec les autres imports (si `@mboapilot/shared` y est déjà importé, ajouter `type EtatImprimable` à cet import) :

```ts
import type { EtatImprimable } from "@mboapilot/shared";
```

puis ajouter, juste après la fonction `exporterJournalComptableRequete` :

```ts
// États de gestion (état des ventes) : l'état complet pour l'écran, ou un fichier à télécharger. Les erreurs de période (400) sont montrées telles quelles.
export async function chargerEtatVentes(token: string, du: string, au: string): Promise<EtatImprimable> {
  const reponse = await appelerServeur(`${BASE}/etats/ventes?du=${du}&au=${au}`, { headers: headersAuth(token) });
  if (!reponse.ok) return lireErreurExport(reponse);
  return lireJson<EtatImprimable>(reponse);
}

export async function telechargerEtatVentes(token: string, format: "pdf" | "csv", du: string, au: string): Promise<{ blob: Blob; nomFichier: string }> {
  const reponse = await appelerServeur(`${BASE}/etats/ventes/${format}?du=${du}&au=${au}`, { headers: headersAuth(token) });
  // une erreur serveur imprévue (500) ne montre pas son message technique : l'utilisateur sait seulement que le fichier n'a pas pu être fabriqué
  if (reponse.status >= 500) throw new Error(`Impossible de générer le ${format === "pdf" ? "PDF" : "CSV"}. Réessayez dans un instant.`);
  if (!reponse.ok) return lireErreurExport(reponse);
  const nomFichier = /filename=([^;]+)/.exec(reponse.headers.get("content-disposition") ?? "")?.[1]?.trim() ?? `etat-des-ventes-${du}-au-${au}.${format}`;
  if (format === "pdf") return { blob: await reponse.blob(), nomFichier };
  // le BOM UTF-8 en tête : sans lui, Excel lit les accents comme du Windows-1252 (« CÃ¢ble »)
  return { blob: new Blob(["\uFEFF", await reponse.text()], { type: "text/csv;charset=utf-8" }), nomFichier };
}
```

- [ ] **Étape 2 : le rendu générique d'un état**

Créer `apps/web/src/components/etats/EtatImprime.tsx` :

```tsx
import { dateHeureDouala, formaterValeurEtat, libellePeriodeEtat, type EtatImprimable, type SectionEtat } from "@mboapilot/shared";
import { cn } from "@/lib/utils";

// Affiche n'importe quel état (`EtatImprimable`) en feuille blanche : à l'écran comme à l'impression A4. Quand un nouvel état s'ajoute côté serveur,
// aucun écran n'est à écrire. Les tableaux répètent leur en-tête à chaque page imprimée et ne coupent pas une ligne en deux.

function TableauEtat({ section }: { section: SectionEtat }) {
  const { colonnes } = section;
  const alignement = (a: "gauche" | "droite") => (a === "droite" ? "text-right tabular-nums" : "text-left");
  return (
    <section className="space-y-1.5">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-700 print:break-after-avoid">{section.titre}</h3>
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse text-xs leading-snug">
          <thead className="print:table-header-group">
            <tr className="bg-neutral-200">
              {colonnes.map((c) => (
                <th key={c.cle} scope="col" className={cn("px-2 py-1 font-semibold", alignement(c.alignement))}>
                  {c.libelle}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.lignes.length === 0 && (
              <tr>
                <td colSpan={colonnes.length} className="px-2 py-2 italic text-neutral-700">
                  {section.messageVide ?? "Aucune donnée"}
                </td>
              </tr>
            )}
            {section.lignes.map((ligne, i) => (
              <tr key={i} className="border-b border-neutral-300 print:break-inside-avoid">
                {ligne.map((valeur, j) => (
                  <td key={colonnes[j].cle} className={cn("px-2 py-1 align-top", alignement(colonnes[j].alignement))}>
                    {formaterValeurEtat(valeur, colonnes[j].type)}
                  </td>
                ))}
              </tr>
            ))}
            {section.totaux && (
              <tr className="border-t-2 border-neutral-800 font-semibold print:break-inside-avoid">
                {section.totaux.map((valeur, j) => (
                  <td key={colonnes[j].cle} className={cn("px-2 py-1 align-top", alignement(colonnes[j].alignement))}>
                    {formaterValeurEtat(valeur, colonnes[j].type)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EtatImprime({ etat }: { etat: EtatImprimable }) {
  return (
    <article className="mx-auto w-full max-w-4xl space-y-6 bg-white p-6 text-neutral-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
      <header className="etat-entete space-y-0.5">
        <p className="font-heading text-lg font-bold">{etat.entete.nomBoutique}</p>
        {etat.entete.lignesContact.map((ligne) => (
          <p key={ligne} className="text-xs text-neutral-700">
            {ligne}
          </p>
        ))}
        <h2 className="pt-3 font-heading text-xl font-bold">{etat.titre}</h2>
        <p className="text-sm">Période : {libellePeriodeEtat(etat.periode)}</p>
        <p className="text-xs text-neutral-700">Généré le {dateHeureDouala(etat.genereLe)}</p>
        {etat.avertissements.map((avertissement) => (
          <p key={avertissement} role="status" className="pt-1 text-sm font-semibold text-red-800">
            Attention : {avertissement}
          </p>
        ))}
      </header>
      {etat.sections.map((section) => (
        <TableauEtat key={section.titre} section={section} />
      ))}
    </article>
  );
}
```

- [ ] **Étape 3 : la page**

Créer `apps/web/src/components/etats/EtatsPage.tsx` :

```tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { jourDouala, nomFichierEtat, raccourcisPeriode, type EtatImprimable } from "@mboapilot/shared";
import { chargerEtatVentes, ErreurAuthentification, telechargerEtatVentes } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, type Vue } from "@/components/layout/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { EtatImprime } from "./EtatImprime";

interface Props {
  onNaviguer: (vue: Vue) => void;
}

// À l'impression, seule la feuille de l'état reste : la navigation et les boutons disparaissent, la page redevient un document A4 qui se
// continue sur autant de pages que nécessaire.
const STYLE_IMPRESSION = `@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body { background: white; }
  .etats-page { display: block !important; height: auto !important; }
  .etats-page header:not(.etat-entete), .etats-page .no-print { display: none !important; }
  .etats-page main { overflow: visible !important; height: auto !important; padding: 0 !important; }
}`;

// 8.6, 9.3 : états de gestion (Administrateur, Gérant, Comptable). Premier état : l'état des ventes d'une période, à l'écran, imprimé en A4, en PDF
// ou en CSV. Les jours sont ceux de Douala.
export function EtatsPage({ onNaviguer }: Props) {
  const { session, deconnecter } = useAuth();
  const token = session!.token;

  const raccourcis = raccourcisPeriode(jourDouala());
  const [periode, setPeriode] = useState(() => raccourcis.find((r) => r.cle === "mois")!.periode);
  const [etat, setEtat] = useState<EtatImprimable | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<"pdf" | "csv" | null>(null);

  const periodeComplete = periode.du !== "" && periode.au !== "";

  useEffect(() => {
    setEtat(null);
    setErreur(null);
    if (!periodeComplete) return;
    // le serveur juge la période (inversée, trop longue) : son message est montré tel quel, sous les dates
    let abandonne = false;
    const identifiant = setTimeout(() => {
      chargerEtatVentes(token, periode.du, periode.au)
        .then((e) => !abandonne && setEtat(e))
        .catch((e) => {
          if (abandonne) return;
          if (e instanceof ErreurAuthentification) {
            toast.error("Session expirée — veuillez vous reconnecter.");
            deconnecter();
            return;
          }
          setErreur(e instanceof Error ? e.message : "Impossible de calculer l'état.");
        });
    }, 250);
    return () => {
      abandonne = true;
      clearTimeout(identifiant);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, periode.du, periode.au]);

  async function telecharger(format: "pdf" | "csv") {
    setEnCours(format);
    try {
      const { blob, nomFichier } = await telechargerEtatVentes(token, format, periode.du, periode.au);
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = etat ? nomFichierEtat(etat, format) : nomFichier;
      lien.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (e instanceof ErreurAuthentification) {
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
        return;
      }
      toast.error(e instanceof Error ? e.message : "Échec du téléchargement.");
    } finally {
      setEnCours(null);
    }
  }

  const peutAgir = etat !== null && erreur === null && enCours === null;

  return (
    <div className="etats-page flex h-dvh flex-col bg-background">
      <style>{STYLE_IMPRESSION}</style>
      <AppHeader vueActive="etats" onNaviguer={onNaviguer} />

      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="no-print mx-auto mb-6 w-full max-w-4xl space-y-4">
          <div>
            <h1 className="font-heading text-lg font-semibold text-foreground">États de gestion</h1>
            <p className="text-sm text-muted-foreground">État des ventes d'une période : à imprimer, en PDF, ou en CSV pour Excel. Les jours sont ceux de Douala.</p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="etat-du">Du</Label>
              <Input id="etat-du" type="date" value={periode.du} onChange={(e) => setPeriode((p) => ({ ...p, du: e.target.value }))} className="mt-1 h-10 w-40" />
            </div>
            <div>
              <Label htmlFor="etat-au">Au (inclus)</Label>
              <Input id="etat-au" type="date" value={periode.au} onChange={(e) => setPeriode((p) => ({ ...p, au: e.target.value }))} className="mt-1 h-10 w-40" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Périodes usuelles">
            {raccourcis.map((r) => {
              const actif = r.periode.du === periode.du && r.periode.au === periode.au;
              return (
                <Button
                  key={r.cle}
                  variant={actif ? "default" : "outline"}
                  size="sm"
                  aria-pressed={actif}
                  className={cn("min-h-11 cursor-pointer sm:min-h-9")}
                  onClick={() => setPeriode(r.periode)}
                >
                  {r.libelle}
                </Button>
              );
            })}
          </div>

          {erreur !== null && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {erreur}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11 cursor-pointer gap-2 sm:min-h-9" disabled={!peutAgir} onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden="true" />
              Imprimer
            </Button>
            <Button variant="outline" className="min-h-11 cursor-pointer gap-2 sm:min-h-9" disabled={!peutAgir} onClick={() => telecharger("pdf")}>
              <FileDown className="size-4" aria-hidden="true" />
              {enCours === "pdf" ? "Préparation…" : "Télécharger le PDF"}
            </Button>
            <Button variant="outline" className="min-h-11 cursor-pointer gap-2 sm:min-h-9" disabled={!peutAgir} onClick={() => telecharger("csv")}>
              <FileSpreadsheet className="size-4" aria-hidden="true" />
              {enCours === "csv" ? "Préparation…" : "Télécharger le CSV"}
            </Button>
          </div>
        </div>

        {etat === null && erreur === null && periodeComplete && <p className="no-print mx-auto max-w-4xl text-sm text-muted-foreground">Calcul de l'état…</p>}
        {etat !== null && erreur === null && <EtatImprime etat={etat} />}
      </main>
    </div>
  );
}
```

- [ ] **Étape 4 : la navigation et le routage**

Dans `apps/web/src/components/layout/AppHeader.tsx`, ajouter dans le tableau `ONGLETS`, entre la ligne `stock` et la ligne `administration` :

```ts
  { vue: "etats", libelle: "États" },
```

Dans `apps/web/src/App.tsx` :

1. ajouter l'import avec les autres pages :

```ts
import { EtatsPage } from "@/components/etats/EtatsPage";
```

2. dans le type `EtatVue`, ajouter, avant la ligne `administration` :

```ts
  | { nom: "etats" }
```

3. dans la chaîne `if / else if` qui choisit `contenuPage`, ajouter avant la branche `administration` :

```tsx
  } else if (vue.nom === "etats") {
    contenuPage = <EtatsPage onNaviguer={naviguer} />;
```

- [ ] **Étape 5 : typage strict**

Run : `cd apps/web && npx tsc --noEmit -p tsconfig.app.json`
Attendu : aucune erreur. (Si `EtatVue` ou la chaîne de rendu de `App.tsx` ont une forme légèrement différente de celle décrite, garder l'esprit : une branche `etats` qui rend `<EtatsPage onNaviguer={naviguer} />`.)

- [ ] **Étape 6 : mise de côté (aucun commit sans ordre)**

Fichiers de la tâche : `apps/web/src/lib/api.ts`, `apps/web/src/components/etats/EtatImprime.tsx`, `apps/web/src/components/etats/EtatsPage.tsx`, `apps/web/src/components/layout/AppHeader.tsx`, `apps/web/src/App.tsx`.

---

### Tâche 9 : vérifications réelles, documentation, suites complètes

**Fichiers :**
- Modifier : `docs/guide-boutique.md`, `docs/exploitation.md`, `docs/superpowers/specs/2026-11-17-etat-des-ventes-design.md`

**Interfaces :** aucune (tâche de vérification et de documentation).

- [ ] **Étape 1 : instance locale jetable avec la boutique fictive**

Réutiliser le script de la session de test des rôles (`serveur-roles.mts` du dossier de travail temporaire) s'il existe encore ; sinon, en écrire un équivalent avec l'outil `Write` : il fixe `MBOAPILOT_DATA_DIR` sur un dossier temporaire dont le nom contient `mboapilot-etats-test`, appelle `appliquerMigrations(db)` puis `peuplerDemo(db)` (`apps/api/src/demo/seed-demo.ts`), crée un compte `GERANT` et un compte `CAISSIER` de test avec `creerUtilisateur`, puis importe `apps/api/src/server.ts`. Lancer sur `PORT=3095` **sans** `MBOAPILOT_DEMO`. Ne jamais utiliser la base par défaut (`apps/api/data/mboapilot.db`).
Vérifier : `curl http://127.0.0.1:3095/api/v1/demo` renvoie `{"actif":false}`.

- [ ] **Étape 2 : les trois sorties depuis cette instance**

Avec un script Node (`fetch`) connecté en Gérant sur `http://127.0.0.1:3095` : télécharger `/api/v1/etats/ventes/pdf?du=<premier jour du mois>&au=<aujourd'hui>`, `/csv` et le JSON ; enregistrer le PDF dans le dossier de travail. Contrôler : `Content-Type`, nom de fichier, début `%PDF-`, CSV commençant par `État des ventes` avec `;`, et que le Caissier reçoit 403 sur les trois routes.

- [ ] **Étape 3 : lire le PDF page par page**

Lire le fichier PDF avec l'outil `Read` (paramètre `pages`) et contrôler à l'œil : en-tête de boutique, titre, période, les cinq sections, alignement des montants à droite, lignes de totaux en gras, titres de colonnes lisibles, pied de page « Page i / n », aucun caractère cassé (« ? » à la place d'un accent, espaces insécables).
Pour voir un état sur plusieurs pages, générer aussi un PDF sur une période plus large ou avec des données plus nombreuses (par exemple en créant une cinquantaine de ventes par l'API de vente, ou en testant avec `limiteDetail` réduit) et vérifier la répétition des titres de colonnes.

- [ ] **Étape 4 : l'écran dans le navigateur**

Avec un script CDP (Chrome headless, comme les vérifications précédentes) ou le panneau navigateur : se connecter en Gérant sur `http://127.0.0.1:3095`, ouvrir « États », vérifier à **1280 px** puis **390 px** de large :
- l'onglet « États » est visible pour Administrateur, Gérant et Comptable, absent pour Caissier (et le Caissier qui force l'adresse n'obtient rien) ;
- les cinq raccourcis de période fonctionnent et celui qui correspond à la période est visuellement actif ;
- une période inversée affiche le message d'erreur du serveur sous les dates et désactive les trois boutons ;
- aucune barre de défilement horizontale de la page (`document.documentElement.scrollWidth <= clientWidth`) ; seul le tableau de détail peut défiler dans son conteneur ;
- « Télécharger le PDF » et « Télécharger le CSV » déclenchent un fichier au bon nom.
Prendre une capture de chaque largeur et la regarder.

- [ ] **Étape 5 : l'impression A4**

Dans le navigateur piloté par CDP, appeler `Page.printToPDF` avec `preferCSSPageSize: true` sur la page « États » chargée, enregistrer le PDF et le lire avec `Read` : la navigation et les boutons ont disparu, la feuille blanche occupe la page A4, les tableaux continuent sur la page suivante avec leurs titres de colonnes répétés, aucune ligne coupée en deux, plusieurs pages si la période est longue.

- [ ] **Étape 6 : détecteur de design**

Run : `node ~/.claude/skills/impeccable/scripts/detect.mjs --json apps/web/src/components/etats/EtatsPage.tsx apps/web/src/components/etats/EtatImprime.tsx apps/web/src/components/layout/AppHeader.tsx apps/web/src/App.tsx`
Attendu : `[]`. Corriger toute remarque avant de continuer.

- [ ] **Étape 7 : documentation**

Dans `docs/guide-boutique.md`, ajouter une section « États de gestion » (après la section sur la journée et la sauvegarde) :

```md
## États de gestion

L'entrée **États** de la navigation (Administrateur, Gérant et Comptable) donne l'**état des ventes** d'une période : un récapitulatif par jour, la répartition par famille d'activité et par mode de paiement, puis le détail facture par facture et les totaux (TTC net des avoirs, TVA, HT, encaissé, reste à payer).

1. Choisissez la période : un raccourci (aujourd'hui, hier, cette semaine, ce mois, mois dernier) ou deux dates. Les jours sont ceux de Douala ; la période ne peut pas dépasser 366 jours.
2. **Imprimer** produit une page A4 avec l'en-tête de la boutique ; **Télécharger le PDF** enregistre le même état dans un fichier prêt à envoyer au comptable ; **Télécharger le CSV** donne un fichier pour Excel.
3. Les avoirs apparaissent en négatif. Les ventes jamais encaissées (paiement Mobile Money abandonné) n'y figurent pas, comme dans le chiffre d'affaires.
4. « Encaissé sur la période » compte les paiements reçus **pendant** la période ; « Reste à payer » est celui d'**aujourd'hui** sur les ventes de la période. Un solde encaissé après la période fait donc baisser le reste à payer sans changer l'encaissé de la période.
5. À l'écran et en PDF, le détail est limité aux **5 000 premières factures** (un message l'indique) : réduisez la période, ou prenez le CSV, qui n'est pas limité.
```

Dans `docs/exploitation.md`, ajouter une courte section (routes et droits) :

```md
### États de gestion (API)

`GET /api/v1/etats/ventes?du=AAAA-MM-JJ&au=AAAA-MM-JJ` (JSON), `/csv` et `/pdf` : réservés à l'Administrateur, au Gérant et au Comptable (comme l'export comptable) ; la boutique est celle de la session. Le PDF est fabriqué par le serveur avec la bibliothèque `pdfkit` (aucun navigateur, aucun accès Internet). Détail limité à 5 000 factures hors CSV. Après une mise à jour qui ajoute ce composant, le lanceur Windows réinstalle seul les composants (`package-lock.json` plus récent que `node_modules`).
```

Dans `docs/superpowers/specs/2026-11-17-etat-des-ventes-design.md` §5.1, ajouter dans la déclaration de `colonnes` le champ optionnel : `poids?: number` (largeur relative d'une colonne de texte dans le PDF, 1 par défaut), et une ligne précisant que « la section finale « Totaux de la période » est une section ordinaire (libellé, montant) ».

- [ ] **Étape 8 : suites complètes, dans cet ordre**

Run :
```bash
cd packages/shared && npx vitest run && npx tsc --noEmit -p .
cd ../../apps/web && npx tsc --noEmit -p tsconfig.app.json
cd ../api && npx tsc --noEmit -p . && npx vitest run > "<dossier de travail>/suite-api-etats.log" 2>&1; echo "FIN exit=$?" >> "<dossier de travail>/suite-api-etats.log"
```
Lire `Test Files … passed` et `FIN exit=0` dans le journal (la suite complète dure environ 7 minutes). Attendu : aucune erreur de type, toutes les suites vertes.

- [ ] **Étape 9 : nettoyage**

Arrêter l'instance de test (port 3095), supprimer son dossier temporaire et les profils Chrome temporaires, vérifier que la base par défaut `apps/api/data/mboapilot.db` n'a pas bougé (taille et date).

- [ ] **Étape 10 : mise de côté (aucun commit sans ordre)**

Lister tous les fichiers du chantier (`git status --short`) et rédiger le message de commit, **sans l'exécuter** : « États de gestion : socle commun et état des ventes (écran, A4, PDF, CSV) », avec un corps qui reprend les décisions de la spécification, et la ligne `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Attendre l'ordre « Commite tout ça », puis plus tard « Push it » (précédé d'une suite API complète fraîche).

---

## Auto-relecture du plan

**Couverture de la spécification.** §4 (écran, raccourcis, trois boutons, noms de fichiers) : tâches 2, 7, 8. §5.1 (modèle, CSV, nom de fichier) : tâche 1. §5.2 (constructeur et extraction du journal) : tâches 3-5. §5.3 (PDF) : tâche 6. §5.4 (routes, garde, site de la session) : tâche 7. §5.5 (rendu générique et impression A4) : tâche 8, vérifiée tâche 9. §6 (règles et quatre recoupements) : tâches 4-5. §7 (erreurs, limite de 5 000, 401/403, échec PDF) : tâches 4, 7, 8. §8 (sécurité) : tâches 1, 7. §9 (tests) et §10 (vérifications réelles) : tâches 1-7 et 9. §11 (dépendance `pdfkit`, documentation) : tâches 6 et 9.

**Écarts assumés avec la spécification.** (1) Champ optionnel `poids` sur les colonnes (largeur relative dans le PDF) : tâche 1, spécification mise à jour tâche 9. (2) Le recoupement 4 « détail = journal CSV » compare le nombre de lignes et le total TTC. (3) L'avertissement de volume s'écrit avec une espace simple (« 5 000 ») : c'est celle du PDF, qui n'a pas l'espace insécable fine.

**Cohérence des noms.** `EtatImprimable`, `SectionEtat`, `ColonneEtat`, `formaterValeurEtat`, `libellePeriodeEtat`, `dateHeureDouala`, `etatVersCsv`, `nomFichierEtat` (tâche 1) ; `raccourcisPeriode` et la vue `"etats"` (tâche 2) ; `listerJournalVentes`, `LigneJournalVentes`, `facturesDeLaPeriode`, `paiementsDeLaPeriode`, `creerResolveurFamilleLigne` (tâche 3) ; `construireEtatVentes`, `LIMITE_DETAIL_PAR_DEFAUT`, `creerFixtureEtatVentes` (tâches 4-5) ; `rendreEtatPdf`, `texteCompatiblePdf` (tâche 6) ; `registerEtatsRoutes` (tâche 7) ; `chargerEtatVentes`, `telechargerEtatVentes`, `EtatImprime`, `EtatsPage` (tâche 8). Les titres de sections sont identiques partout : « Récapitulatif par jour », « Répartition par famille d'activité », « Répartition par mode de paiement », « Détail facture par facture », « Totaux de la période ».

**Point à surveiller à l'exécution.** Le typage global `PDFKit.PDFDocument` dépend de la version de `@types/pdfkit` : la tâche 6 (étape 5) donne la parade si `tsc` ne le reconnaît pas. Les valeurs chiffrées des tests des tâches 4 et 5 viennent de la table du jeu de données ; si une valeur diverge à l'exécution, vérifier d'abord le jeu de données (avoir et remboursement rattachés à F3, solde de F2 en décembre) avant de toucher au calcul.
