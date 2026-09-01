# CLAUDE.md — MboaPilot

## Contexte
MboaPilot est une application de gestion et de pilotage multi-services pour
petites entreprises camerounaises : vente de produits, abonnements TV
satellite (CANAL+, DStv, StarTimes, 24H Sport, Moreplex), abonnements
streaming/IPTV, SAV, caisse/facturation.

Le cahier des charges complet (v1.0, 30/08/2026) fait foi et prime sur toute
reformulation ci-dessous en cas de divergence :
- [docs/cahier-des-charges.pdf](docs/cahier-des-charges.pdf) — document de référence
- [docs/cahier-des-charges-texte.txt](docs/cahier-des-charges-texte.txt) — extraction texte, pour grep rapide

Ce n'est PAS un projet vitrine/marketing : pas d'animations au scroll, pas de
Lenis/GSAP obligatoires. C'est une application métier (formulaires, tableaux,
écran de caisse, tableau de bord) où la vitesse de saisie et la fiabilité des
calculs priment sur l'effet visuel.

## Stack imposée
- **Monorepo** : `apps/api` (backend), `apps/web` (frontend), `packages/shared`
  (types + logique métier pure, ex. moteur de calcul de validité).
- **Backend** : Node.js + TypeScript, Fastify pour l'API REST versionnée
  (`/api/v1/...`).
- **ORM / DB** : Drizzle ORM + `better-sqlite3`, SQLite en mode WAL
  (`PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON` obligatoires à chaque
  connexion). Migrations Drizzle versionnées, jamais de modification manuelle
  du schéma en prod.
- **Frontend** : React 19 + TypeScript + Vite, Tailwind CSS v4 (config
  CSS-first via `@theme`, jamais de `tailwind.config.js`), shadcn/ui pour les
  composants. Interface responsive (poste de caisse fixe → tablette).
- **Packaging mode local** : Tauri (empreinte mémoire/disque réduite, adapté
  aux postes d'entrée de gamme visés par le cahier des charges §11.1).
- **Tests** : Vitest pour les tests unitaires/régression (obligatoire pour le
  moteur de dates, voir plus bas), Playwright pour les parcours critiques
  (caisse, recrutement) à partir de la V1.
- Consulter les MCP magicui et shadcn avant d'écrire un composant à la main.

## Règles métier non négociables
Ces règles viennent du cahier des charges et ne doivent jamais être
réinterprétées sans relire la section citée.

- **Cycle de validité « 30 jours date à date »** (§4.1) : `date_fin =
  date_debut + (N × 30) − 1 jour` en mode `STRICT_30J` (mode par défaut de
  toutes les formules à l'initialisation). Le mode `MOIS_CIVIL` est un
  paramètre par formule, jamais codé en dur. Cas de référence à utiliser comme
  test de non-régression (§4.2) : abonné recruté le 16/11/2025, formule 1
  mois → `date_fin` = 15/12/2025.
- **Numéro d'abonné ≠ numéro d'abonnement** (§4.5) : `id_abonne` est pérenne et
  ne change jamais ; `numero_abonnement` peut changer (ex. échange de
  matériel). Toute recherche client doit résoudre indifféremment sur les deux
  numéros ou le nom/prénom.
- **Catalogue entièrement paramétrable** (§5.1, §8.8) : aucune formule, aucun
  prix, aucune règle de calcul de kit codés en dur. Le champ `regle_prix` d'un
  kit (`PRIX_DECODEUR_VARIABLE_SELON_FORMULE`, `PRIX_KIT_FIXE_PAR_DIFFERENTIEL`,
  `PRIX_FIXE`) pilote le calcul dynamique du prix (§5.1.1).
- **Cycle de facturation brouillon → validée** (§6.4) : toute opération
  génère une facture `BROUILLON`, non imprimable. Le premier encaissement
  (même partiel) la fait passer en `VALIDÉE`, imprimable, et une facture
  `VALIDÉE` ne se modifie plus directement — toute correction passe par un
  avoir tracé.
- **Migration de formule** (§7.4) : uniquement vers une formule de rang
  strictement supérieur, en cours de période ; la rétrogradation n'est
  possible qu'au réabonnement suivant.
- **Suivi commission CANAL+ sur 4 mois** (§6.2) : uniquement déclenché sur un
  **recrutement** CANAL+ (pas un réabonnement), période probatoire de 119
  jours, annulée si l'abonnement expire dans la période, confirmée sinon.
- **Journal d'audit immuable** (§11.5) : toute création/modification/
  suppression de facture, encaissement, changement de statut d'abonnement,
  de formule, de matériel, de stock, ou d'utilisateur doit être tracée
  (utilisateur, horodatage, valeur avant/après).
- **RBAC de bout en bout** (§11.2) : les droits par rôle (Administrateur,
  Gérant, Caissier/Vendeur, Technicien SAV, Comptable, Apporteur d'affaires)
  s'appliquent côté API, jamais uniquement côté interface.
- **Aucune opération destructrice sans confirmation + traçabilité** (§9.1).
- **Interface en français** par défaut ; prévoir une couche de traduction dès
  la conception (clés de traduction, jamais de chaîne en dur) sans
  nécessairement livrer l'anglais au MVP.

## Règles de développement
- Le moteur de calcul de validité (`packages/shared`) est la pièce la plus
  critique du système (§13.2) : développement en TDD strict, jeu de tests
  couvrant changements d'année, mois de 28/29/30/31 jours (`MOIS_CIVIL`), et
  le cas de référence Nga Ndongo. Ce jeu de tests est rejoué à chaque
  livraison, jamais modifié pour faire passer un bug.
- Toute intégration de paiement mobile (Orange Money, §6.6) doit être
  idempotente sur la référence de transaction opérateur — un callback reçu
  deux fois ne doit jamais créer deux paiements.
- Ne pas construire au-delà du périmètre de la phase en cours (voir Phasage
  ci-dessous). Le cahier des charges est volontairement exhaustif ; y piocher
  au-delà du MVP avant que le MVP ne soit stable est une dérive de scope.
- Respecter `prefers-reduced-motion` sur les animations d'interface qui
  existent (transitions d'état, feedback de caisse) — pas d'obligation
  d'animation d'entrée au scroll comme sur un site vitrine.

## Phasage imposé (cahier des charges §12.1)
1. **MVP** : mode local mono-site, catalogue CANAL+/DStv/StarTimes complet,
   recrutement + réabonnement (§7.1-7.2), caisse (§9.2), paiement cash
   uniquement, tableau de bord de base avec alertes J-7/J-3/J-1.
2. **V1** : + 24H Sport/Moreplex/Streaming-IPTV, SAV complet, échange de
   matériel et changement de formule (§7.3-7.4), marges/gains (§6.1),
   apporteurs d'affaires (§6.3), suivi commission CANAL+ (§6.2), Orange
   Money (§6.6).
3. **V2** : mode en ligne hébergé, multi-utilisateurs avancé, multi-site
   centralisé, modèle de commercialisation SaaS + licence (chapitre 10).
4. **V3** : multi-site distribué avec sync hors ligne, API tierces,
   extension à d'autres opérateurs/pays.

Ne pas anticiper une phase avant que la précédente ne soit fonctionnelle et
testée.

## Workflow imposé
1. Consulter la skill ui-ux-pro-max pour le style, la palette et la typo des
   écrans (caisse, tableau de bord, fiche abonné).
2. Construire en TDD pour toute logique métier (moteur de dates, calcul de
   prix de kit, cycle de facturation).
3. Passer `/impeccable` avant de livrer un écran.
