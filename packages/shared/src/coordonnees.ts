import { memeTelephone } from "./telephone.js";

// Coordonnées de la boutique : imprimées sur les tickets, les factures et les pro-forma, et reprises dans les messages de relance aux clients.
// Règle partagée par l'API (qui la fait respecter) et par le formulaire (qui la vérifie pendant la saisie).
export interface CoordonneesBoutique {
  telephone?: string | null;
  telephoneWhatsapp?: string | null;
  email?: string | null;
  siteWeb?: string | null;
}

const LONGUEUR_MAX_EMAIL = 254;
const LONGUEUR_MAX_SITE_WEB = 200;

const FORME_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
// « www.boutique.cm », « boutique.cm » ou « https://boutique.cm/accueil » : http et https seulement (jamais « javascript: » ni « ftp: »)
const FORME_SITE_WEB = /^(https?:\/\/)?([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(:\d+)?(\/\S*)?$/;

export function erreurEmail(valeur: string): string | null {
  const propre = valeur.trim();
  if (propre === "") return "L'e-mail est vide";
  if (propre.length > LONGUEUR_MAX_EMAIL) return `L'e-mail ne peut pas dépasser ${LONGUEUR_MAX_EMAIL} caractères`;
  if (!FORME_EMAIL.test(propre)) return "L'e-mail doit ressembler à contact@boutique.cm";
  return null;
}

export function erreurSiteWeb(valeur: string): string | null {
  const propre = valeur.trim();
  if (propre === "") return "Le site web est vide";
  if (propre.length > LONGUEUR_MAX_SITE_WEB) return `Le site web ne peut pas dépasser ${LONGUEUR_MAX_SITE_WEB} caractères`;
  if (!FORME_SITE_WEB.test(propre)) return "Le site web doit ressembler à www.boutique.cm (sans espace)";
  return null;
}

const nettoyer = (valeur: string | null | undefined) => (valeur ?? "").trim();

// lignes d'en-tête des documents imprimés : ce qui n'est pas renseigné n'apparaît pas
export function lignesContactBoutique(coordonnees: CoordonneesBoutique): string[] {
  const telephone = nettoyer(coordonnees.telephone);
  const whatsapp = nettoyer(coordonnees.telephoneWhatsapp);
  const email = nettoyer(coordonnees.email);
  const siteWeb = nettoyer(coordonnees.siteWeb);

  const lignes: string[] = [];
  if (telephone && whatsapp && memeTelephone(telephone, whatsapp)) lignes.push(`Tél et WhatsApp : ${telephone}`);
  else if (telephone && whatsapp) lignes.push(`Tél : ${telephone} · WhatsApp : ${whatsapp}`);
  else if (telephone) lignes.push(`Tél : ${telephone}`);
  else if (whatsapp) lignes.push(`WhatsApp : ${whatsapp}`);
  if (email) lignes.push(email);
  if (siteWeb) lignes.push(siteWeb);
  return lignes;
}

// fin des SMS de relance : court (un SMS ne doit pas s'allonger inutilement), uniquement les numéros. Vide si aucun n'est renseigné.
export function texteContactMessage(coordonnees: CoordonneesBoutique): string {
  const telephone = nettoyer(coordonnees.telephone);
  const whatsapp = nettoyer(coordonnees.telephoneWhatsapp);
  if (telephone && whatsapp && memeTelephone(telephone, whatsapp)) return `Contact (appel et WhatsApp) : ${telephone}.`;
  if (telephone && whatsapp) return `Contact : ${telephone} ou WhatsApp ${whatsapp}.`;
  if (telephone) return `Contact : ${telephone}.`;
  if (whatsapp) return `Contact WhatsApp : ${whatsapp}.`;
  return "";
}
