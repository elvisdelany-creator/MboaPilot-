// Verrou de connexion par compte ET adresse, pour le mode hébergé. Le verrou par compte seul (5 échecs, 15 minutes, pour tout le monde) est
// un moyen de bloquer l'administrateur à distance : il suffit de cinq mots de passe faux, répétés. Ici, seule l'adresse qui se trompe est
// bloquée pour ce compte : l'administrateur reste connectable depuis la boutique, même s'il est attaqué d'ailleurs.
// En mémoire (un seul processus) : un redémarrage remet les compteurs à zéro, ce qu'un visiteur ne peut pas provoquer.
const MAX_ECHECS = 5;
const DUREE_MS = 15 * 60_000;
const TAILLE_MAX_AVANT_PURGE = 10_000;

export interface OptionsVerrou {
  maxEchecs?: number;
  dureeVerrouMs?: number; // aussi la fenêtre dans laquelle les échecs s'additionnent
  horloge?: () => number;
}

export interface VerdictVerrou {
  verrouille: boolean;
  reessayerDansSecondes: number;
}

// l'identifiant n'est pas sensible à la casse ni aux espaces (« Admin » et « admin » sont le même compte) ; le séparateur ne peut pas apparaître
// dans un identifiant, donc deux couples différents ne partagent jamais une clé
export function cleVerrouConnexion(identifiant: unknown, adresse: string): string {
  const compte = typeof identifiant === "string" ? identifiant.trim().toLowerCase() : "\u0001invalide";
  return `${compte}\u0000${adresse}`;
}

export function creerVerrouConnexion(options: OptionsVerrou = {}) {
  const maxEchecs = options.maxEchecs ?? MAX_ECHECS;
  const dureeMs = options.dureeVerrouMs ?? DUREE_MS;
  const horloge = options.horloge ?? Date.now;
  const etats = new Map<string, { echecs: number; debut: number; verrouilleJusqua: number }>();

  function purger() {
    const maintenant = horloge();
    for (const [cle, e] of etats) {
      if (e.verrouilleJusqua <= maintenant && maintenant - e.debut >= dureeMs) etats.delete(cle);
    }
  }

  function verifier(cle: string): VerdictVerrou {
    const e = etats.get(cle);
    const maintenant = horloge();
    if (!e || e.verrouilleJusqua <= maintenant) return { verrouille: false, reessayerDansSecondes: 0 };
    return { verrouille: true, reessayerDansSecondes: Math.ceil((e.verrouilleJusqua - maintenant) / 1000) };
  }

  function enregistrerEchec(cle: string): void {
    const maintenant = horloge();
    if (etats.size > TAILLE_MAX_AVANT_PURGE) purger();
    let e = etats.get(cle);
    // pendant le verrouillage, un échec de plus ne le prolonge pas : un script qui insiste ne bloque pas l'adresse à vie
    if (e && e.verrouilleJusqua > maintenant) return;
    // échecs trop espacés (ou verrouillage terminé) : on repart de zéro
    if (!e || maintenant - e.debut >= dureeMs || e.verrouilleJusqua > 0) {
      e = { echecs: 0, debut: maintenant, verrouilleJusqua: 0 };
      etats.set(cle, e);
    }
    e.echecs += 1;
    if (e.echecs >= maxEchecs) {
      e.verrouilleJusqua = maintenant + dureeMs;
      e.echecs = 0;
    }
  }

  function reinitialiser(cle: string): void {
    etats.delete(cle);
  }

  return { verifier, enregistrerEchec, reinitialiser, taille: () => etats.size };
}

export type VerrouConnexion = ReturnType<typeof creerVerrouConnexion>;
