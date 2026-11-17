// Mode hébergé : MboaPilot sur un serveur joignable depuis Internet, au lieu du poste de caisse local. Il ne s'active que sur demande explicite
// (MBOAPILOT_HEBERGE=1) : un poste local n'a besoin d'aucun de ces réglages et ne bascule jamais par hasard.
type Environnement = Record<string, string | undefined>;

export function estModeHeberge(env: Environnement = process.env): boolean {
  return env.MBOAPILOT_HEBERGE === "1";
}

const LONGUEUR_MIN_SECRET_JWT = 32;

// Ce qu'un serveur exposé ne peut pas faire par défaut, contrairement à un poste local : un secret ou une clé générés au hasard sur le disque
// seraient perdus avec le serveur, et un plafond de débit qui compterait l'adresse du proxy plutôt que celle du visiteur ne protégerait de rien.
// Renvoie TOUTES les erreurs, pour tout corriger en une fois ; liste vide si la configuration convient (ou hors mode hébergé).
export function erreursConfigurationHeberge(env: Environnement = process.env): string[] {
  if (!estModeHeberge(env)) return [];
  const erreurs: string[] = [];

  if ((env.JWT_SECRET ?? "").length < LONGUEUR_MIN_SECRET_JWT) {
    erreurs.push(`JWT_SECRET doit être défini, avec au moins ${LONGUEUR_MIN_SECRET_JWT} caractères (secret de signature des sessions).`);
  }
  if (!env.MBOAPILOT_ENCRYPTION_KEY) {
    erreurs.push("MBOAPILOT_ENCRYPTION_KEY doit être définie (clé de chiffrement des comptes partagés : 64 caractères hexadécimaux).");
  }
  if (!/^[1-9]\d*$/.test(env.MBOAPILOT_PROXY ?? "")) {
    erreurs.push("MBOAPILOT_PROXY doit indiquer le nombre de proxys devant l'application (1 en général) : sans lui, les plafonds de débit compteraient l'adresse du proxy.");
  }
  if (env.MBOAPILOT_DEMO === "1") {
    erreurs.push("Le mode hébergé ne peut pas tourner avec MBOAPILOT_DEMO=1 : la démo publique est une boutique fictive à comptes partagés.");
  }
  if (env.MBOAPILOT_MOBILE_MONEY_SIMULE === "1") {
    erreurs.push("Le mode hébergé refuse MBOAPILOT_MOBILE_MONEY_SIMULE=1 : le simulateur Mobile Money déclare payé tout paiement, que le client ait payé ou non.");
  }
  return erreurs;
}
