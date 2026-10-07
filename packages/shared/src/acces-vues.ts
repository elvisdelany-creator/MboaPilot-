// 2.5.1 : matrice rôles → écrans de l'application. Elle reprend les gardes
// exigerRole de l'API (apps/api/src/app.ts) pour que l'interface ne propose
// jamais un écran dont les appels seraient refusés (toasts « Rôle non autorisé »,
// boutons sans effet). La sécurité reste portée par l'API : ceci n'est que de
// l'ergonomie, jamais un contrôle d'accès.

export type RoleUtilisateur = "ADMINISTRATEUR" | "GERANT" | "CAISSIER" | "TECHNICIEN_SAV" | "COMPTABLE" | "APPORTEUR";

export type VueApplication = "dashboard" | "caisse" | "sav" | "clients" | "apporteurs" | "stock" | "administration";

// ordre = ordre d'affichage de la navigation principale
const ROLES_PAR_VUE: Record<VueApplication, readonly RoleUtilisateur[]> = {
  dashboard: ["ADMINISTRATEUR", "GERANT", "CAISSIER", "TECHNICIEN_SAV", "COMPTABLE"],
  caisse: ["ADMINISTRATEUR", "GERANT", "CAISSIER"], // vente (exigerRole « ventes »)
  sav: ["ADMINISTRATEUR", "GERANT", "CAISSIER", "TECHNICIEN_SAV"], // exigerRole « sav »
  clients: ["ADMINISTRATEUR", "GERANT", "CAISSIER", "COMPTABLE"], // lecture financière
  apporteurs: ["ADMINISTRATEUR", "GERANT"],
  stock: ["ADMINISTRATEUR", "GERANT"], // « Catalogue »
  administration: ["ADMINISTRATEUR", "GERANT"],
};

export function peutAccederVue(role: RoleUtilisateur, vue: VueApplication): boolean {
  return ROLES_PAR_VUE[vue].includes(role);
}

export function vuesAccessibles(role: RoleUtilisateur): VueApplication[] {
  return (Object.keys(ROLES_PAR_VUE) as VueApplication[]).filter((vue) => peutAccederVue(role, vue));
}
