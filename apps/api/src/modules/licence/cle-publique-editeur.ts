// Clé PUBLIQUE de l'éditeur de MboaPilot (base64, format SPKI). Elle permet de vérifier les clés de renouvellement, jamais d'en fabriquer : elle
// peut figurer dans le dépôt. La clé PRIVÉE, elle, reste chez l'éditeur, hors du dépôt.
//
// Vide : le renouvellement par clé n'est pas activé, l'administrateur saisit l'échéance (fonctionnement du pilote).
// Pour l'activer, dans apps/api : npm run licence:paire -- --sortie <chemin hors du dépôt>   (voir docs/exploitation.md)
export const CLE_PUBLIQUE_EDITEUR = "";
