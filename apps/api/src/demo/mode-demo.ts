import type { RoleUtilisateur } from "@mboapilot/shared";

// Démo publique (boutique d'essai ouverte à des visiteurs sur Internet). MboaPilot est conçu comme une application LOCALE : ce mode ne
// doit jamais être activé sur la vraie base d'une boutique (le lanceur de démo travaille d'ailleurs dans son propre dossier, jamais dans
// celui des vraies données — voir server-demo.ts).
export function estModeDemo(env: Record<string, string | undefined> = process.env): boolean {
  return env.MBOAPILOT_DEMO === "1";
}

export interface CompteDemo {
  role: Extract<RoleUtilisateur, "GERANT" | "CAISSIER" | "TECHNICIEN_SAV">;
  libelle: string;
  identifiant: string;
  motDePasse: string;
}

// Comptes partagés par tous les visiteurs, affichés sur l'écran de connexion (ce ne sont pas des secrets : la boutique est fictive).
// Pas de compte Administrateur : le Gérant voit le catalogue, le stock et le tableau de bord, sans pouvoir gérer les comptes ni la licence.
export const COMPTES_DEMO: readonly CompteDemo[] = [
  { role: "GERANT", libelle: "Gérant", identifiant: "gerant.demo", motDePasse: "Demo-Gerant-2026" },
  { role: "CAISSIER", libelle: "Caissier", identifiant: "caissier.demo", motDePasse: "Demo-Caisse-2026" },
  { role: "TECHNICIEN_SAV", libelle: "Technicien SAV", identifiant: "technicien.demo", motDePasse: "Demo-Tech-2026" },
];

export const MESSAGE_FONCTION_DESACTIVEE_EN_DEMO = "Cette fonction est désactivée dans la démo publique : les comptes et les réglages sont partagés entre tous les visiteurs.";

// Écritures qui, faites par un visiteur, gêneraient tous les suivants (mot de passe d'un compte partagé, comptes, sites, licence,
// réglages de l'entreprise) ou exposeraient des fichiers (sauvegardes, installation). Refusées par le serveur, pas seulement masquées dans
// l'interface : le Gérant accède à l'écran Administration. Les lectures restent libres.
const PREFIXES_BLOQUES_EN_DEMO = [
  "/api/v1/auth/mot-de-passe",
  "/api/v1/utilisateurs",
  "/api/v1/sites",
  "/api/v1/licence",
  "/api/v1/sauvegarde",
  "/api/v1/installation",
  "/api/v1/entreprise",
];

export function ecritureBloqueeEnDemo(methode: string, url: string): boolean {
  const m = methode.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  const chemin = url.split("?")[0];
  // « /api/v1/sites » ou « /api/v1/sites/… », jamais un préfixe voisin comme « /api/v1/sitesmaison »
  return PREFIXES_BLOQUES_EN_DEMO.some((prefixe) => chemin === prefixe || chemin.startsWith(`${prefixe}/`));
}

// Envois de fichiers (photos d'un dossier SAV, import CSV du catalogue) : chacun peut écrire jusqu'à 1 Mo sur le disque du serveur
const ENVOI_PHOTO_SAV = /^\/api\/v1\/sav\/dossiers\/[^/]+\/photos$/;

export function estTeleversement(methode: string, url: string): boolean {
  if (methode.toUpperCase() !== "POST") return false;
  const chemin = url.split("?")[0];
  return ENVOI_PHOTO_SAV.test(chemin) || chemin === "/api/v1/produits/import-csv";
}
