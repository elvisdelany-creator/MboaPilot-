export interface ConfigurationLimite {
  fenetreMs: number;
  maximum: number;
}

export interface VerdictLimite {
  autorise: boolean;
  reessayerDansSecondes: number;
}

// Plafond de requêtes par adresse sur une fenêtre fixe, en mémoire (un seul processus). Sert à la démo publique : sans visiteur de confiance,
// un script peut saturer un petit serveur gratuit ou essayer des mots de passe en rafale.
export function creerLimiteurDebit(configuration: ConfigurationLimite, horloge: () => number = Date.now) {
  const compteurs = new Map<string, { debut: number; nombre: number }>();

  function nettoyer() {
    const maintenant = horloge();
    for (const [cle, c] of compteurs) {
      if (maintenant - c.debut >= configuration.fenetreMs) compteurs.delete(cle);
    }
  }

  function verifier(cle: string): VerdictLimite {
    const maintenant = horloge();
    let compteur = compteurs.get(cle);
    if (!compteur || maintenant - compteur.debut >= configuration.fenetreMs) {
      compteur = { debut: maintenant, nombre: 0 };
      compteurs.set(cle, compteur);
      // la table ne doit pas grossir sans fin sous un balayage d'adresses : on purge les fenêtres passées de temps en temps
      if (compteurs.size > 10_000) nettoyer();
    }
    compteur.nombre += 1;
    if (compteur.nombre <= configuration.maximum) return { autorise: true, reessayerDansSecondes: 0 };
    return { autorise: false, reessayerDansSecondes: Math.max(1, Math.ceil((compteur.debut + configuration.fenetreMs - maintenant) / 1000)) };
  }

  return { verifier, nettoyer, taille: () => compteurs.size };
}
