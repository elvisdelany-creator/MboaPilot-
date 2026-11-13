# Utiliser MboaPilot pour de vrai, sur l'ordinateur de la boutique

Ce guide est pour le gérant. MboaPilot tourne **sur l'ordinateur de la boutique** : pas besoin d'Internet pour
vendre, et rien n'est exposé en ligne. Les détails techniques sont dans `exploitation.md`.

> ⚠️ **Avant la première vraie vente, lisez la section 4** : le paiement « Mobile Money » de l'application est
> pour l'instant un **simulateur**.

## 1. Ce qu'il faut

- Un ordinateur **Windows** qui reste à la boutique, avec **Node.js 20 ou plus** ([nodejs.org](https://nodejs.org)).
- Le dossier du projet MboaPilot (déjà sur l'ordinateur).
- Une **clé USB ou un second disque** pour les copies de sécurité (section 5).
- Au **premier lancement seulement**, une connexion Internet (téléchargement des composants).

## 2. Premier démarrage

1. Double-cliquez sur **`lancer-mboapilot.bat`**. La première fois, il installe ce qui manque (quelques minutes),
   puis ouvre l'application dans le navigateur. **Laissez sa fenêtre ouverte (réduite)** : la fermer arrête
   MboaPilot.
2. Un **assistant d'installation** s'affiche : nom de l'entreprise, nom de la boutique, puis **votre compte
   administrateur** (identifiant et mot de passe que *vous* choisissez). Personne d'autre ne connaît ce mot de passe
   et il ne peut pas être retrouvé : **notez-le en lieu sûr**.
3. Créez tout de suite un **second administrateur** (Administration → Utilisateurs), par précaution.
4. Pour que MboaPilot démarre tout seul à l'ouverture de Windows : **`demarrage-automatique-installer.bat`**.

## 3. Avant la première vente

À faire une seule fois, dans cet ordre :

1. **Catalogue** : sur une boutique neuve, l'écran de caisse dit « Votre catalogue est vide » et propose deux
   boutons. *Administration → Catalogue → Catalogue de départ* charge les formules des opérateurs choisis
   (CANAL+, DStv, StarTimes…). **Ce sont des tarifs de référence : vérifiez-les avec les prix actuels.** Le
   chargement indique ce qui reste à compléter (par exemple un kit « en attente » de prix, qui reste invendable
   tant que vous ne l'avez pas renseigné).
2. **Articles et services** (décodeurs, câbles, installation…) : écran *Stock*, un par un ou par fichier CSV.
3. **Paramètres** (Administration → Paramètres) : TVA si vous en appliquez une, mentions légales, logo.
4. **Utilisateurs** : un compte par personne (caissier, technicien SAV, comptable, apporteur…). Pas de compte
   partagé : chaque action est tracée au nom de celui qui la fait.
5. **Format d'impression** : sur l'écran du reçu, choisissez **Ticket 80 mm** ou **A5 × 2** (une feuille A4
   paysage portant la facture en deux exemplaires, client et boutique). Le choix est retenu sur le poste. Dans la
   fenêtre d'impression, laissez la mise à l'échelle à 100 %.

## 4. Les paiements : ce qui est sûr, ce qui ne l'est pas

| Mode | État |
|---|---|
| **Comptant** | Fiable. |
| **Chèque** | Fiable (banque, numéro, titulaire, date). |
| **Virement** | Fiable (banque et référence). |
| **Mobile Money** | ⚠️ **Simulateur.** L'application ne parle à aucun opérateur : elle déclare le paiement « confirmé » au bout de quelques secondes, **que le client ait payé ou non**. |

**Pour un vrai paiement Mobile Money, n'utilisez pas le mode « Mobile Money ».** Vérifiez d'abord la réception du
paiement sur le téléphone de la boutique, puis encaissez en **Virement**, en indiquant l'opérateur comme banque
(par exemple « Orange Money ») et **l'identifiant de transaction du SMS** comme référence. Il reste tracé et
rapprochable. Le branchement à un vrai opérateur n'existe pas encore.

## 5. La journée et la sauvegarde

- **Matin** : ouvrir la caisse (fond de caisse). **Soir** : **clôturer la caisse** : l'écart est contrôlé et une
  sauvegarde complète est créée.
- **Chaque jour, copiez la sauvegarde hors de l'ordinateur** : branchez la clé USB et double-cliquez sur
  **`sauvegarde-externe.bat`** (il demande le dossier de destination, par exemple `E:\MboaPilot-copie`). Il copie les
  sauvegardes **et** la clé de chiffrement `.encryption-key`, les photos SAV et le logo. Rangez la clé ailleurs que
  près de l'ordinateur : un vol ou un incendie emporterait les deux.
- Si le script dit « aucune sauvegarde trouvée », faites d'abord **Administration → Paramètres → Exporter mes
  données**, puis relancez-le.
- **Ne copiez jamais le seul fichier `mboapilot.db`** pendant que MboaPilot tourne : il peut être vide ou périmé.
  Utilisez toujours le script ou « Exporter mes données ».

## 6. Si l'ordinateur tombe en panne

Sur un autre ordinateur Windows : installez Node.js, recopiez le dossier du projet, puis suivez
`exploitation.md` §3 (« Restaurer sur un autre poste ») avec la clé USB : une commande
(`npm run db:restaurer -- fichier-de-sauvegarde.db`), puis copiez `.encryption-key`, `sav-photos` et `logos`.
Cette procédure a été essayée de bout en bout : clients, factures, utilisateurs et catalogue sont retrouvés et
l'administrateur se reconnecte avec son mot de passe habituel.

## 7. À ne pas faire

- **Ne fermez pas la fenêtre du lanceur** pendant que vous travaillez.
- **N'ouvrez pas MboaPilot sur Internet** (n'utilisez pas `MBOAPILOT_HOTE`) : l'application n'est protégée contre
  les attaques en ligne que dans un mode hébergé qui reste à terminer.
- **N'utilisez jamais** les comptes de la démo publique ni `npm run db:seed:dev` sur la vraie base.
- **Avant toute mise à jour** du code : une sauvegarde (voir `exploitation.md` §4).

## 8. Plus tard : passer en ligne

Quand vous voudrez travailler à distance : un petit serveur (VPS) avec disque durable sur une adresse comme
`app.nextservicescameroon.com`, le « mode hébergé » (protections Internet), et votre base importée par la même
restauration que ci-dessus. Rien de ce que vous aurez saisi en local n'est perdu.
