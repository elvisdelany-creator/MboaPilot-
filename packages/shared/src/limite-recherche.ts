// Nombre maximal de clients renvoyés par une recherche : une seule lettre renvoyait 40 000 résultats (7,4 Mo à chaque
// frappe) sur 50 000 clients. Partagé par l'API (qui borne) et l'interface (qui invite à affiner quand il est atteint).
export const LIMITE_RESULTATS_RECHERCHE_ABONNES = 50;
