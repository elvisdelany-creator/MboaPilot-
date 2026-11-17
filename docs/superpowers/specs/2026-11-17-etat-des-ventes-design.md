# États de gestion : le socle commun et l'état des ventes

Conception validée le 2026-11-17 (cadrage avec le propriétaire de MboaPilot). Premier cycle d'un chantier plus large : cinq états de gestion
(ventes, caisse du jour, stock, commissions, échéances). Ce cycle construit le **socle commun** et le premier état, **l'état des ventes**.

## 1. Pourquoi

Un gérant veut des états papier : une période, des totaux, l'en-tête de sa boutique, à imprimer, à envoyer au comptable ou à retravailler
dans un tableur. L'application a un tableau de bord (§8.6 du cahier des charges), un export comptable CSV (journal des ventes et des
encaissements) et l'impression navigateur des reçus, mais ni état récapitulatif, ni vrai fichier PDF. Le cahier des charges prévoit une
« génération de PDF côté serveur » (§11, technologie).

## 2. Décisions

| Sujet | Décision |
|---|---|
| Premier état | L'état des ventes. Les quatre autres suivront, un par cycle, sur le même socle |
| Sorties | Écran (gérant), impression A4, **fichier PDF téléchargé**, CSV pour Excel français |
| PDF | Un vrai fichier fabriqué par l'application, sans Internet, avec la bibliothèque `pdfkit` (JavaScript pur, sans composant natif) |
| Architecture | Une structure d'état neutre construite **côté serveur** ; écran, CSV et PDF en sont trois rendus. Calculs et droits à un seul endroit |
| Droits | Administrateur, Gérant, Comptable (même garde que le pilotage financier et l'export comptable) |
| Contenu de l'état des ventes | Récapitulatif par jour, répartition par famille d'activité, répartition par mode de paiement, détail facture par facture, totaux |
| Marge, détail par vendeur | Hors de cet état (la marge reste sur le tableau de bord) |

## 3. Hors périmètre de ce cycle

Les états de caisse, de stock, de commissions et d'échéances ; le détail par vendeur ; le logo dans le PDF ; la consolidation de plusieurs
boutiques ; l'envoi par e-mail ; la programmation d'états récurrents.

## 4. Ce que voit et fait le gérant

- Une entrée **« États »** dans la navigation, visible des seuls rôles autorisés (nouvelle vue `etats` dans `ROLES_PAR_VUE`).
- La **période** : raccourcis (aujourd'hui, hier, cette semaine, ce mois, mois dernier) et dates personnalisées. Par défaut : le mois en cours
  jusqu'à aujourd'hui. Les dates sont des jours de Douala. Limite de 366 jours, messages d'erreur en français sous les dates.
- L'état s'affiche en cinq blocs : en-tête (boutique, adresse, contacts, période, date et heure de génération), récapitulatif par jour,
  répartition par famille, répartition par mode de paiement, détail facture par facture, puis les totaux.
- Trois boutons : **Imprimer**, **Télécharger le PDF**, **Télécharger le CSV**. Fichiers nommés `etat-des-ventes-AAAA-MM-JJ-au-AAAA-MM-JJ.pdf` / `.csv`.

## 5. Architecture

Quatre unités, chacune avec un seul rôle.

### 5.1 Le modèle d'un état (`packages/shared`)

```ts
interface EtatImprimable {
  identifiant: string;          // « etat-des-ventes »
  titre: string;                // « État des ventes »
  periode: { du: string; au: string };           // AAAA-MM-JJ, jours de Douala
  entete: { nomBoutique: string; lignesContact: string[] };
  genereLe: string;             // horodatage ISO
  sections: SectionEtat[];
  avertissements: string[];     // ex. « détail limité aux 5 000 premières factures »
}
interface SectionEtat {
  titre: string;
  colonnes: { cle: string; libelle: string; type: "texte" | "entier" | "fcfa" | "date"; alignement: "gauche" | "droite" }[];
  lignes: (string | number)[][];                 // même ordre que les colonnes
  totaux?: (string | number)[];                  // ligne de totaux, même ordre
  messageVide?: string;                          // montré quand `lignes` est vide
}
```

Deux fonctions pures, testées seules : `etatVersCsv(etat)` (séparateur `;`, mêmes protections que `construireCsv` contre les formules de tableur, une
section après l'autre séparées d'une ligne vide, titre et période en tête) et `nomFichierEtat(etat, extension)`.

### 5.2 Le constructeur de l'état des ventes (`apps/api/src/modules/etats`)

`construireEtatVentes(db, siteId, periode, options)` renvoie un `EtatImprimable`. La période est validée par `verifierPeriodeExport`, déjà utilisée
par l'export comptable (366 jours, dates réelles, fin ≥ début).

Réutilisation, sans duplication :
- le **détail facture par facture** vient du calcul du journal des ventes, que j'extrais d'`export-comptable.service.ts` en une fonction qui renvoie des
  lignes structurées ; l'export CSV actuel l'appelle aussi, et ses tests existants garantissent qu'il ne change pas ;
- la **répartition par famille** réutilise le résolveur de famille du tableau de bord (`creerResolveurFamilleLigne`, à exporter).

### 5.3 Le rendu PDF (`apps/api/src/modules/etats/etat-pdf.ts`)

`rendreEtatPdf(etat): Promise<Buffer>` dessine l'état en A4 portrait avec `pdfkit` : en-tête de boutique, titre et période, tableaux, sauts de page
avec répétition des titres de colonnes, pied de page « Page 1 / 3 » et date de génération. Police standard Helvetica (accents français gérés) ;
tout caractère hors de son jeu (notamment l'espace insécable fine des nombres formatés en français) est remplacé avant l'écriture, jamais laissé
cassé.

### 5.4 Les routes (`apps/api/src/modules/etats/etats.routes.ts`)

| Route | Réponse |
|---|---|
| `GET /api/v1/etats/ventes?du=…&au=…` | JSON `EtatImprimable` (pour l'écran et l'impression) |
| `GET /api/v1/etats/ventes/csv?du=…&au=…` | CSV, `Content-Disposition` avec le nom de fichier |
| `GET /api/v1/etats/ventes/pdf?du=…&au=…` | PDF, `Content-Disposition` avec le nom de fichier |

Garde : authentification + rôles du pilotage (Administrateur, Gérant, Comptable). La boutique est celle de la session ; un paramètre `siteId` éventuel
dans l'adresse est ignoré.

### 5.5 Le rendu à l'écran et à l'impression (`apps/web`)

Une page `EtatsPage` (sélecteur de période, boutons) et un composant générique `EtatImprime` qui affiche n'importe quel `EtatImprimable` en tableaux.
Impression A4 par CSS (`@page`, en-tête de tableau répété à chaque page, éléments de navigation masqués). Quand un nouvel état s'ajoute, aucun
écran n'est à écrire : seulement un constructeur côté serveur.

## 6. Règles de calcul

Toutes les règles ci-dessous sont celles de l'application ; l'état ne réinvente rien.

- **Ventes de la période :** factures au statut `VALIDEE` dont la date tombe dans la période (jours de Douala, bornes incluses). Les ventes en attente de
  paiement n'en font pas partie, comme du chiffre d'affaires.
- **Avoirs :** comptés en négatif sur leur propre date, à côté de la facture qu'ils corrigent dans le détail. Le total TTC de l'état est donc **net**
  des avoirs.
- **Montants :** les prix sont TTC ; la TVA est celle figée sur la facture (`montantTaxe`) ; HT = TTC − TVA.
- **Récapitulatif par jour :** une ligne par jour **avec activité** : nombre de ventes, nombre d'avoirs, total TTC net, dont TVA, total HT. Total en bas.
- **Répartition par famille :** somme des prix des lignes, par famille d'abonnement (CANAL+, DStv…), « Produits & Services », « SAV », « Autre » ; même
  résolution que le tableau de bord. Total en bas.
- **Répartition par mode de paiement :** paiements dont **la date de paiement** tombe dans la période (un acompte et son solde tombent chacun dans leur mois),
  par mode (espèces, chèque, virement, Mobile Money), remboursements en négatif. Total en bas.
- **Détail facture par facture :** colonnes Date, N°, Type, Client, Détail, Total TTC, Encaissé, Reste à payer. Le « reste à payer » est celui d'aujourd'hui
  (total + avoirs − encaissé), comme dans le journal CSV.
- **Totaux de l'état :** total TTC net, dont TVA, total HT ; encaissé sur la période (somme de la répartition par mode) ; reste à payer des ventes de la
  période (somme du détail).

### Recoupements garantis par les tests

1. Somme des jours = totaux TTC / TVA / HT de l'état.
2. Somme des familles = total TTC net de l'état (donc avoirs inclus).
3. Somme des modes de paiement = « encaissements » de l'aperçu de l'export comptable pour la même période.
4. Somme du détail (hors reste) = total TTC net ; nombre de lignes du détail = nombre de lignes du journal CSV des ventes.

## 7. Erreurs et cas limites

- Période invalide, inversée, trop longue : 400 et message français (celui de `verifierPeriodeExport`), affiché sous les dates.
- Période sans vente : état valide, sections avec `messageVide` (« Aucune vente sur cette période »), totaux à zéro.
- 401 sans connexion, 403 pour un rôle non autorisé.
- **Garde-fou de volume :** à l'écran, en PDF et dans le JSON, le détail est limité à **5 000 factures** (les plus anciennes d'abord, comme le journal), avec
  l'avertissement « Détail limité aux 5 000 premières factures : réduisez la période ou utilisez le CSV ». Le CSV n'est pas limité. La limite est un
  paramètre du constructeur, pour la tester sans fabriquer 5 000 factures.
- Échec de génération du PDF : le détail va au journal du serveur (`[API] erreur interne non prévue`) ; l'utilisateur voit « Impossible de générer le PDF ».

## 8. Sécurité et droits

- RBAC appliqué par le serveur (§11.2). Un `siteId` dans l'adresse n'a aucun effet.
- CSV : toute valeur qui commence par `= + - @` est neutralisée par `echapperChampCsv`, comme les exports actuels.
- PDF : le texte est dessiné, jamais interprété ; aucun contenu HTML.
- Pas de nouvelle donnée stockée, pas de migration : lecture seule.

## 9. Tests (écrits avant le code)

- **`packages/shared`** : `etatVersCsv` (sections, séparateur, cellules piégées, section vide), `nomFichierEtat`, formatage des montants.
- **Constructeur (API)** : jeu de données couvrant des ventes sur plusieurs jours dont une à la frontière de minuit de Douala, un avoir, un impayé
  partiel, une vente en attente (exclue), plusieurs familles, des produits et du SAV, et des paiements des quatre modes avec un remboursement. Vérifie
  chaque section et les quatre recoupements du §6. Période vide. Limite de volume avec un seuil réduit.
- **PDF** : plusieurs pages, accents, espace insécable, section vide, texte long, et présence réelle des textes attendus (flux non compressé en test).
- **Routes** : Administrateur, Gérant et Comptable reçoivent 200 ; Caissier, Technicien SAV et Apporteur 403 ; sans compte 401 ; erreurs de période 400 ;
  en-têtes (`Content-Type`, `Content-Disposition`) ; PDF qui commence par `%PDF` ; isolation entre boutiques (un utilisateur du site B ne voit rien du site A).
- **Non-régression** : les tests de l'export comptable existants restent verts après l'extraction du calcul commun.

## 10. Vérifications réelles avant livraison

1. Instance locale jetable (boutique fictive) : l'écran à 1280 et 390 px de large, sans débordement.
2. Détecteur de design Impeccable à `[]`.
3. PDF et CSV générés depuis cette instance ; **PDF lu page par page** pour contrôler la mise en page ; CSV ouvert avec le séparateur attendu.
4. Impression A4 vérifiée par une vraie sortie PDF du navigateur : pagination, titres de colonnes répétés, navigation masquée.
5. Suite API complète, suites partagée et web, `tsc` pour les trois paquets.
6. Après mise en ligne de la démo : contrôle de l'écran et des trois sorties avec le compte Gérant.

## 11. Livraison

- Nouvelle dépendance `pdfkit` (et ses types) dans `apps/api`. Une mise à jour d'un poste demande de relancer l'installation des composants, ce que
  `lancer-mboapilot.bat` fait pour ce qui manque (à vérifier en cours de cycle, et à documenter).
- Documentation : `guide-boutique.md` (comment lire et imprimer l'état) et `exploitation.md` (routes, droits, limite de volume).
- Ordre des cycles suivants : état de caisse du jour, états du stock, des échéances et des commissions.
