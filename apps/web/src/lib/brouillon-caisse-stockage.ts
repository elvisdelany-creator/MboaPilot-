// Brouillon du ticket de caisse (voir packages/shared/src/brouillon-caisse.ts) : gardé dans l'onglet (sessionStorage), pour survivre à un
// changement de page et à un rechargement sans traverser la fermeture de l'onglet. Le stockage peut être absent ou refusé (navigation
// privée, quota) : la caisse fonctionne alors comme avant, sans brouillon.

// une clé par utilisateur : le brouillon d'un caissier n'apparaît jamais à celui qui se connecte ensuite sur le même poste
export const cleBrouillonCaisse = (idUtilisateur: number) => `mboapilot.caisse.brouillon.${idUtilisateur}`;

export function lireStockageBrouillon(cle: string): string | null {
  try {
    return sessionStorage.getItem(cle);
  } catch {
    return null;
  }
}

// brut null : plus rien à garder, on efface
export function ecrireStockageBrouillon(cle: string, brut: string | null): void {
  try {
    if (brut === null) sessionStorage.removeItem(cle);
    else sessionStorage.setItem(cle, brut);
  } catch {
    // stockage indisponible : le ticket reste en mémoire, simplement sans filet
  }
}
