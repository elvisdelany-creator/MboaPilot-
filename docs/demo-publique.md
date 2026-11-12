# Démo publique de MboaPilot (boutique d'essai en ligne)

Ce guide explique comment mettre en ligne une **boutique fictive** que des visiteurs peuvent essayer, par exemple sur
`mboapilot.nextservicescameroon.com`. Ce n'est **pas** la manière d'installer MboaPilot chez un commerçant : une vraie
boutique reste un poste local (voir `docs/exploitation.md`).

## Ce que c'est, et ce que ça n'est pas

- La démo est une boutique **entièrement fictive** (clients, ventes, stock, dossiers SAV, apporteurs) fabriquée à chaque
  démarrage. Les dates sont relatives à aujourd'hui : il y a toujours des échéances à relancer et des abonnements expirés.
- Elle **repart de zéro** à chaque démarrage : le dossier de données est jetable (`/tmp/mboapilot-demo`). Sur Render
  gratuit, le service s'endort après 15 minutes sans visite et se réveille avec une boutique neuve ; un redémarrage est en
  plus forcé après 24 h de fonctionnement continu.
- **Aucun message n'est envoyé** (SMS et e-mails sont simulés), **aucun paiement réel** (Mobile Money simulé).
- Trois comptes partagés, affichés sur l'écran de connexion : **Gérant**, **Caissier**, **Technicien SAV**. Pas de compte
  Administrateur.

## Ce que le mode démo protège

L'application n'a pas été conçue pour être ouverte sur Internet ; le mode démo ajoute ces garde-fous, **vérifiés par des
tests automatiques** :

| Risque | Protection |
|---|---|
| Un visiteur change le mot de passe d'un compte partagé | Refusé par le serveur (403) ; le bouton est masqué |
| Un visiteur crée, désactive ou modifie des comptes, des sites, la licence, les réglages de l'entreprise | Refusé par le serveur (403) |
| Sauvegardes téléchargées, assistant d'installation | Refusés (403) |
| Un visiteur se trompe 5 fois et verrouille un compte partagé | Le verrouillage est désactivé en démo ; le plafond ci-dessous le remplace |
| Script qui sature le serveur ou essaie des mots de passe | Plafonds **par adresse** : 600 requêtes/min, 20 connexions/min, 8 envois de fichiers/min (429 au-delà) |
| Remplir le disque avec des photos ou des imports | Les envois de fichiers sont plafonnés (ci-dessus) et limités à 1 Mo chacun |
| Navigateur qui retombe en HTTP | En-tête HSTS ajouté quand la requête arrive en HTTPS |
| Licence qui passe en lecture seule après 21 jours | Revalidée automatiquement toutes les 12 h |
| Effacer par erreur de vraies données | Le lanceur n'efface qu'un dossier dont le nom contient « demo », et n'utilise jamais le dossier des vraies données |

À savoir : un visiteur peut **modifier le catalogue, vendre, encaisser, clôturer la caisse**. C'est voulu (c'est ce
qu'il vient essayer) ; tout est remis à zéro au prochain démarrage.

## Essayer en local

```bash
npm install
npm run build
npm run start:demo        # puis ouvrez http://127.0.0.1:3001
```

`MBOAPILOT_DEMO_DIR` change le dossier jetable (son nom doit contenir « demo »). Sous Windows, `set PORT=3029` avant la
commande change le port.

## Mettre en ligne sur Render (offre gratuite)

Votre hébergement `nextservicescameroon.com` (LWS) est **statique** : il ne peut pas faire tourner MboaPilot, qui est
un serveur Node.js. La démo tourne donc chez un hébergeur de serveurs, et le sous-domaine `mboapilot` y est redirigé.

Limites de l'offre gratuite de Render, d'après leur [documentation](https://render.com/docs/free) : le service **s'endort
après 15 minutes sans visite** et met environ une minute à se réveiller (la première personne attend) ; le disque est
éphémère ; 750 heures gratuites par mois ; Render peut redémarrer le service à tout moment. Les domaines personnalisés et
le certificat HTTPS sont inclus.

### Ce que vous faites (je ne peux pas le faire à votre place)

> Les intitulés exacts des menus de Render peuvent évoluer : en cas de doute, suivez les pages « Blueprints » et « Custom Domains » de leur documentation.

1. **Créer un compte sur render.com**, puis l'autoriser à lire votre dépôt GitHub (`elvisdelany-creator/MboaPilot-`).
   Si Render demande un moyen de paiement, lisez ce qu'il annonce avant de l'ajouter : sans moyen de paiement, Render
   suspend les services gratuits qui dépassent leur quota de bande passante.
2. Dans Render : **New → Blueprint**, choisir le dépôt. Render lit `render.yaml` (service `mboapilot-demo`, offre
   gratuite, région Francfort) et construit l'image avec le `Dockerfile`. Le premier déploiement prend quelques minutes.
3. Quand il est terminé, Render donne une adresse du type `mboapilot-demo.onrender.com`. **Ouvrez-la** : l'écran de
   connexion doit proposer les trois comptes de démonstration.
4. Dans Render, ouvrir le service, **Settings → Custom Domains → Add**, saisir `mboapilot.nextservicescameroon.com`.
   Render affiche la valeur du **CNAME** à créer (c'est une adresse en `.onrender.com`).
5. Chez LWS, dans l'espace client, ouvrir la **Zone DNS** du domaine (voir
   l'[aide LWS sur les zones DNS avancées](https://help.lwshosting.com/a/54)) et ajouter un enregistrement **CNAME** :
   nom `mboapilot`, valeur = celle donnée par Render. Un CNAME doit pointer vers un nom, pas vers une adresse IP. S'il
   existe déjà une ligne `mboapilot` (type A) créée avec le sous-domaine d'hébergement, **remplacez-la** : un CNAME ne
   peut pas cohabiter avec une autre ligne de même nom.
6. Attendre la propagation (de quelques minutes à 24 h), puis cliquer **Verify** dans Render : le certificat HTTPS est
   émis automatiquement.

### Après la mise en ligne

- **Réglage du proxy** (`MBOAPILOT_PROXY`, **3** dans l'image) : le plafond de débit compte chaque visiteur selon son
  adresse, lue dans `X-Forwarded-For` **en comptant depuis la droite**, car chaque proxy de l'hébergeur y ajoute l'adresse
  qu'il voit sans retirer ce que le visiteur a écrit. Sur Render, l'en-tête arrive sous la forme « visiteur, serveur
  Cloudflare, serveur interne Render » : le visiteur est la **troisième** adresse depuis la droite (mesuré sur le service
  déployé, en novembre 2026). Avec un chiffre trop bas, on compte l'adresse interne, qui change à chaque requête : le
  plafond ne se déclenche jamais (c'est ce qui s'est produit avec 1). Avec un chiffre trop haut, une adresse inventée par le
  visiteur serait retenue. **Sur un autre hébergeur, ce chiffre est à remesurer** : envoyer deux requêtes, comparer les
  adresses de l'en-tête, et vérifier qu'au bout de 20 connexions ratées par minute le serveur répond 429.

- **Mise à jour** : chaque `git push` sur `master` redéploie la démo (`autoDeploy: true`).
- **Mettre l'adresse sur votre site** : ajoutez sur `nextservicescameroon.com` un lien « Essayer la démo » vers
  `https://mboapilot.nextservicescameroon.com`, avec la mention « premier chargement : environ une minute ».
- **QR code des tickets** : la démo n'a pas d'adresse publique de vérification réglée (les réglages sont verrouillés en
  démo) ; les tickets de la démo n'impriment donc pas de QR code.
- **Surveiller** : Render affiche les journaux du service. Une réponse 429 vue souvent signale un visiteur trop pressé.

## Si vous préférez un serveur qui ne s'endort pas

Un petit serveur payant (VPS) évite l'attente d'une minute. Le même `Dockerfile` convient ; fixez alors
`MBOAPILOT_DEMO_REDEMARRAGE_HEURES` (par exemple 6) et laissez le superviseur (Docker, systemd) relancer le processus :
c'est ce redémarrage qui remet la démo à zéro, puisque le disque n'est plus éphémère.
