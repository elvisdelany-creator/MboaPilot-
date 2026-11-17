# Utiliser MboaPilot pour de vrai, sur l'ordinateur de la boutique

Ce guide est pour le gérant. MboaPilot tourne **sur l'ordinateur de la boutique** : pas besoin d'Internet pour
vendre, et rien n'est exposé en ligne. Les détails techniques sont dans `exploitation.md`.

> ⚠️ **Avant la première vraie vente, lisez la section 4** : le paiement « Mobile Money » n'est pas branché à un
> vrai opérateur ; l'application le **masque** donc à la caisse.

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

## 2 bis. Où vivent vos données (à décider avant le premier lancement)

Par défaut, tout (clients, factures, sauvegardes, photos) est rangé dans `apps\api\data`, **à l'intérieur du dossier du
projet**. Mieux vaut un dossier à part : mettre à jour, déplacer ou supprimer le dossier du projet n'emporte alors pas
vos données.

1. **Créez un dossier** hors du projet, par exemple `C:\MboaPilot-donnees` (évitez les accents dans le nom).
2. **Créez un fichier texte `donnees.txt`** dans le dossier du projet, à côté de `lancer-mboapilot.bat`. Il contient
   **une seule ligne : le chemin du dossier**, par exemple `C:\MboaPilot-donnees`. Attention : Windows masque souvent
   les extensions et peut l'enregistrer sous le nom `donnees.txt.txt`, qui ne marcherait pas.
3. **Lancez `lancer-mboapilot.bat`** : la fenêtre affiche `Dossier des donnees : C:\MboaPilot-donnees`. **Vérifiez cette
   ligne.** Si elle affiche `...\apps\api\data`, le fichier n'a pas été pris en compte (nom ou emplacement).

Ce réglage vaut aussi pour le démarrage automatique et pour `sauvegarde-externe.bat`. Le dossier est créé tout seul
s'il n'existe pas. Pour les commandes saisies à la main (par exemple `npm run db:restaurer`), indiquez d'abord le
dossier : `set MBOAPILOT_DATA_DIR=C:\MboaPilot-donnees` dans l'invite de commandes.

**Ordre de priorité** : la variable `MBOAPILOT_DATA_DIR` si elle existe, sinon `donnees.txt`, sinon `apps\api\data`.

> ⚠️ **Ne changez pas ce chemin après avoir commencé à travailler sans recopier vos données.** Si l'**assistant
> d'installation** réapparaît alors que vous avez déjà des ventes, c'est que le lanceur n'a pas retrouvé votre dossier :
> fermez-le, ne refaites **pas** l'installation, et vérifiez la ligne « Dossier des donnees ».

**Si vous avez déjà des données dans `apps\api\data`** (essais précédents que vous voulez garder) : fermez MboaPilot,
copiez **tout** le contenu de ce dossier (y compris les fichiers cachés `.encryption-key` et `.jwt-secret`, et les
sous-dossiers) vers le nouveau dossier, créez `donnees.txt`, relancez, vérifiez un client récent, et gardez l'ancien
dossier tant que vous n'avez pas vérifié. Si vous préférez repartir de zéro, laissez simplement l'ancien dossier de côté.

## 3. Avant la première vente

À faire une seule fois, dans cet ordre :

1. **Catalogue** : sur une boutique neuve, l'écran de caisse dit « Votre catalogue est vide » et propose deux
   boutons. *Administration → Catalogue → Catalogue de départ* charge les formules des opérateurs choisis
   (CANAL+, DStv, StarTimes…). **Ce sont des tarifs de référence : vérifiez-les avec les prix actuels.** Le
   chargement indique ce qui reste à compléter (par exemple un kit « en attente » de prix, qui reste invendable
   tant que vous ne l'avez pas renseigné).
2. **Articles et services** (décodeurs, câbles, installation…) : écran *Stock*, un par un ou par fichier CSV.
3. **Paramètres** (Administration → Paramètres) : TVA si vous en appliquez une, mentions légales, logo.
   **Coordonnées de la boutique** : tout en haut de la même page, section **« Coordonnées de la boutique »** :
   **Adresse, Téléphone, Téléphone WhatsApp, E-mail, Site web** (tous facultatifs, chacun vérifié à la saisie), puis
   **Enregistrer**. Ils s'impriment **sous le nom de la boutique** sur le ticket, la pro-forma, la facture A5 × 2 et le
   ticket de l'imprimante thermique ; ce qui est vide n'apparaît pas. Les **numéros de téléphone et WhatsApp** sont
   aussi ajoutés à la fin des messages de relance (voir la remarque ci-dessous). Le champ **« Mentions légales »** reste
   pour les mentions obligatoires (numéro de registre du commerce, NIU…), imprimées **en bas** des documents.
   > ⚠️ **Les relances ne partent pas encore** : l'envoi de SMS et de WhatsApp n'est pas branché à un opérateur (voir
   > `exploitation.md` §7). Les messages sont préparés, avec votre numéro à la fin, et notés « Simulée : non envoyée »
   > dans la fiche du client. À la place, le **tableau de bord** propose, pour chaque abonnement à échéance et chaque
   > abonnement expiré, un bouton **« Relancer sur WhatsApp »** : il ouvre WhatsApp avec le message déjà écrit, adressé
   > au client (le même bouton est dans la **fiche du client**, sur chacun de ses abonnements non résiliés) ; **c'est vous qui appuyez sur « envoyer »**, depuis votre propre WhatsApp (sur ce poste ou sur le
   > téléphone de la boutique). Si le numéro du client n'est pas utilisable (par exemple 10 chiffres sans indicatif),
   > le bouton est grisé : corrigez le numéro dans sa fiche, avec **9 chiffres** (Cameroun) ou l'indicatif en `+`.
   > **Chaque clic est noté** dans la fiche du client (onglet Notifications : message, heure, nom de la personne, mention
   > « WhatsApp ouvert : envoi à la main »), et la ligne du tableau de bord affiche « Relancé sur WhatsApp le … » :
   > on voit tout de suite qui a déjà été relancé. L'application ne peut pas savoir si vous avez vraiment envoyé le
   > message : elle note que WhatsApp a été ouvert.
4. **Utilisateurs** : un compte par personne (caissier, technicien SAV, comptable, apporteur…). Pas de compte
   partagé : chaque action est tracée au nom de celui qui la fait.
5. **Format d'impression** : sur l'écran du reçu, choisissez **Ticket 80 mm** ou **A5 × 2** (une feuille A4
   paysage portant la facture en deux exemplaires, client et boutique). Le choix est retenu sur le poste. Dans la
   fenêtre d'impression, laissez la mise à l'échelle à 100 %.

## 4. Les paiements : ce qui est sûr, ce qui ne l'est pas

| Mode | État |
|---|---|
| **Comptant** | Fiable. |
| **Chèque** | Fiable : banque, numéro, titulaire et date sont **obligatoires** (le serveur les exige aussi). Un chèque postdaté ne dépasse pas un an. |
| **Virement** | Fiable : banque et référence sont **obligatoires** (le serveur les exige aussi). Il reste « à rapprocher » jusqu'à vérification sur le relevé de banque. |
| **Mobile Money** | ⛔ **Masqué à la caisse** : le seul opérateur fourni est un simulateur, qui déclarerait le paiement « confirmé » au bout de quelques secondes, **que le client ait payé ou non**. Le serveur refuse aussi de l'enregistrer (message « Le paiement Mobile Money n'est pas disponible »). |

**Pour un paiement Mobile Money d'un client**, vérifiez d'abord la réception du paiement sur le téléphone de la
boutique, puis encaissez en **Virement**, en indiquant l'opérateur comme banque (par exemple « Orange Money ») et
**l'identifiant de transaction du SMS** comme référence. Il reste tracé et rapprochable. Le branchement à un vrai
opérateur n'existe pas encore.

*Pour une formation ou un essai sur un poste* (jamais pour de l'argent réel), l'administrateur technique peut rouvrir
le mode simulé en lançant MboaPilot avec la variable `MBOAPILOT_MOBILE_MONEY_SIMULE=1` (voir `exploitation.md`).

## 5. La journée et la sauvegarde

- **Matin** : ouvrir la caisse (fond de caisse). **Soir** : **clôturer la caisse** : l'écart est contrôlé. La
  clôture crée une sauvegarde de la journée, même si l'ordinateur a redémarré entre-temps (elle n'est évitée que
  si une sauvegarde date de moins de deux minutes).
- **Chaque jour, copiez la sauvegarde hors de l'ordinateur** : branchez la clé USB et double-cliquez sur
  **`sauvegarde-externe.bat`** (il demande le dossier de destination, par exemple `E:\MboaPilot-copie`). Il copie les
  sauvegardes **et** la clé de chiffrement `.encryption-key`, les photos SAV et le logo. Rangez la clé ailleurs que
  près de l'ordinateur : un vol ou un incendie emporterait les deux.
- **Si vous n'avez pas clôturé la caisse** (journée sans clôture, ou vente faite après la clôture), faites d'abord
  **Administration → Paramètres → Exporter mes données** : cela crée à l'instant une sauvegarde qui contient toutes
  les ventes, sinon la copie peut ne contenir que la sauvegarde du démarrage. Le script dit « aucune sauvegarde
  trouvée » s'il n'y en a aucune.
- **Ne copiez jamais le seul fichier `mboapilot.db`** pendant que MboaPilot tourne : il peut être vide ou périmé.
  Utilisez toujours le script ou « Exporter mes données ».

**Liste de contrôle à imprimer** : `docs/liste-de-controle.html` (ouvrez-la dans le navigateur, Ctrl+P, une feuille
A4) ou `docs/liste-de-controle.pdf`. Ouverture, journée, clôture, sauvegarde, que faire en cas de problème : une case
à cocher par geste, à garder près de l'ordinateur.

## 5 bis. États de gestion

L'entrée **États** de la navigation (Administrateur, Gérant et Comptable) donne l'**état des ventes** d'une période : un récapitulatif par jour, la répartition par famille d'activité et par mode de paiement, puis le détail facture par facture et les totaux (TTC net des avoirs, TVA, HT, encaissé, reste à payer).

1. Choisissez la période : un raccourci (aujourd'hui, hier, cette semaine, ce mois, mois dernier) ou deux dates. Les jours sont ceux de Douala ; la période ne peut pas dépasser 366 jours.
2. **Imprimer** produit une page A4 avec l'en-tête de la boutique ; **Télécharger le PDF** enregistre le même état dans un fichier prêt à envoyer au comptable ; **Télécharger le CSV** donne un fichier pour Excel.
3. Les avoirs apparaissent en négatif. Les ventes jamais encaissées (paiement Mobile Money abandonné) n'y figurent pas, comme dans le chiffre d'affaires.
4. « Encaissé sur la période » compte les paiements reçus **pendant** la période ; « Reste à payer » est celui d'**aujourd'hui** sur les ventes de la période. Un solde encaissé après la période fait donc baisser le reste à payer sans changer l'encaissé de la période. La colonne « Encaissé à ce jour » du détail compte tous les paiements reçus à ce jour sur chaque facture, quelle que soit leur date : elle peut donc différer de « Encaissé sur la période », qui ne compte que les paiements reçus pendant la période (y compris ceux de factures plus anciennes).
5. À l'écran et en PDF, le détail est limité aux **5 000 premières factures** (un message l'indique) : réduisez la période, ou prenez le CSV, qui n'est pas limité.

## 6. Si l'ordinateur tombe en panne

Sur un autre ordinateur Windows : installez Node.js, recopiez le dossier du projet, puis suivez
`exploitation.md` §3 (« Restaurer sur un autre poste ») avec la clé USB : une commande
(`npm run db:restaurer -- fichier-de-sauvegarde.db`), puis copiez `.encryption-key`, `sav-photos` et `logos`.
Cette procédure a été essayée de bout en bout : clients, factures, utilisateurs et catalogue sont retrouvés et
l'administrateur se reconnecte avec son mot de passe habituel.

## 7. À ne pas faire

- **Ne fermez pas la fenêtre du lanceur** pendant que vous travaillez.
- **N'ouvrez pas MboaPilot sur Internet** (n'utilisez pas `MBOAPILOT_HOTE`) : le **mode hébergé** (protections
  Internet) existe, mais il n'a pas encore été éprouvé en conditions réelles : ne l'utilisez qu'en suivant `exploitation.md` §9.
- **N'utilisez jamais** les comptes de la démo publique ni `npm run db:seed:dev` sur la vraie base.
- **Avant toute mise à jour** du code : une sauvegarde (voir `exploitation.md` §4).

## 8. Plus tard : passer en ligne

Quand vous voudrez travailler à distance : un petit serveur (VPS) avec disque durable sur une adresse comme
`app.nextservicescameroon.com`, le « mode hébergé » (protections Internet, `exploitation.md` §9), et votre base importée par la même
restauration que ci-dessus. Rien de ce que vous aurez saisi en local n'est perdu.
