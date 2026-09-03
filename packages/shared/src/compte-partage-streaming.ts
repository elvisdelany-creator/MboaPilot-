// 5.9 : alerte de capacité — refuse d'affecter un écran/profil supplémentaire
// à un compte partagé (Netflix, Prime Vidéo, IPTV…) une fois son nombre
// d'écrans simultanés autorisés atteint.
export function peutAffecterEcran(nombreEcransMax: number, ecransOccupes: number): boolean {
  return ecransOccupes < nombreEcransMax;
}
