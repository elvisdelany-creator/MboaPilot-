import type {
  AlerteEcheance,
  Abonne,
  Abonnement,
  Apporteur,
  CatalogueFamille,
  ChangerStatutSavResultat,
  DossierSav,
  DossierSavDetaille,
  EchangeMaterielResultat,
  FicheApporteur,
  NouvelAbonne,
  Produit,
  RecrutementResultat,
  StatutSav,
  Utilisateur,
} from "./types";

const BASE = "/api/v1";

// distingue une session expirée/invalide (-> forcer la reconnexion) d'une
// erreur métier ordinaire (-> simple message à l'utilisateur)
export class ErreurAuthentification extends Error {}

async function lireJson<T>(reponse: Response): Promise<T> {
  const corps = await reponse.json();
  if (!reponse.ok) {
    const message = corps?.erreur ?? "Erreur inattendue";
    if (reponse.status === 401) throw new ErreurAuthentification(message);
    throw new Error(message);
  }
  return corps as T;
}

function headersAuth(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export async function login(identifiant: string, motDePasse: string): Promise<{ token: string; utilisateur: Utilisateur }> {
  const reponse = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiant, motDePasse }),
  });
  return lireJson(reponse);
}

export async function rechercherAbonnes(token: string, siteId: number, q: string): Promise<Abonne[]> {
  if (!q.trim()) return [];
  const params = new URLSearchParams({ siteId: String(siteId), q });
  const reponse = await fetch(`${BASE}/abonnes?${params.toString()}`, { headers: headersAuth(token) });
  return lireJson<Abonne[]>(reponse);
}

export async function chargerCatalogue(token: string): Promise<CatalogueFamille[]> {
  const reponse = await fetch(`${BASE}/catalogue`, { headers: headersAuth(token) });
  return lireJson<CatalogueFamille[]>(reponse);
}

// 9.2 : nécessaire pour détecter si l'abonné a déjà un abonnement dans la
// famille sélectionnée (réabonnement) ou non (recrutement).
export async function chargerAbonnementsAbonne(token: string, idAbonne: number): Promise<Abonnement[]> {
  const reponse = await fetch(`${BASE}/abonnes/${idAbonne}/abonnements`, { headers: headersAuth(token) });
  return lireJson<Abonnement[]>(reponse);
}

// 8.6, 9.3 : abonnements à échéance (J-7/J-3/J-1) pour le tableau de bord
export async function chargerAlertesEcheance(token: string, siteId: number): Promise<AlerteEcheance[]> {
  const reponse = await fetch(`${BASE}/alertes-echeance?siteId=${siteId}`, { headers: headersAuth(token) });
  return lireJson<AlerteEcheance[]>(reponse);
}

export interface RecruterPayload {
  siteId: number;
  userId: number;
  aujourdHui: string;
  abonne: { idAbonne: number } | NouvelAbonne;
  idFormule: number;
  idKit?: number;
  montantEncaisse: number;
  apporteurId?: number;
}

export async function recruter(token: string, payload: RecruterPayload): Promise<RecrutementResultat> {
  const reponse = await fetch(`${BASE}/recrutements`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<RecrutementResultat>(reponse);
}

// 5.2, 7.3 : catalogue des produits/pièces détachées, pour l'échange de matériel
export async function chargerProduits(token: string, siteId: number): Promise<Produit[]> {
  const reponse = await fetch(`${BASE}/produits?siteId=${siteId}`, { headers: headersAuth(token) });
  return lireJson<Produit[]>(reponse);
}

export interface EchangerMaterielPayload {
  siteId: number;
  userId: number;
  idProduit: number;
  typeMateriel: string;
  numeroSerie?: string;
  sousGarantie: boolean;
  motif: string;
  montantEncaisse: number;
}

export async function echangerMaterielRequete(
  token: string,
  numeroAbonnement: number,
  payload: EchangerMaterielPayload
): Promise<EchangeMaterielResultat> {
  const reponse = await fetch(`${BASE}/abonnements/${numeroAbonnement}/echange-materiel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<EchangeMaterielResultat>(reponse);
}

export interface ReabonnerPayload {
  siteId: number;
  userId: number;
  aujourdHui: string;
  idFormule?: number;
  montantEncaisse: number;
}

export async function reabonnerRequete(
  token: string,
  numeroAbonnement: number,
  payload: ReabonnerPayload
): Promise<RecrutementResultat> {
  const reponse = await fetch(`${BASE}/abonnements/${numeroAbonnement}/reabonnements`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<RecrutementResultat>(reponse);
}

// 5.10, 8.4 : module SAV
export async function chargerDossiersSav(token: string, siteId: number): Promise<DossierSav[]> {
  const reponse = await fetch(`${BASE}/sav/dossiers?siteId=${siteId}`, { headers: headersAuth(token) });
  return lireJson<DossierSav[]>(reponse);
}

export async function chargerDossierSav(token: string, idDossierSav: number): Promise<DossierSavDetaille> {
  const reponse = await fetch(`${BASE}/sav/dossiers/${idDossierSav}`, { headers: headersAuth(token) });
  return lireJson<DossierSavDetaille>(reponse);
}

export interface OuvrirDossierSavPayload {
  siteId: number;
  idAbonne?: number;
  descriptionPanne: string;
  etatReception?: string;
  sousGarantie: boolean;
  userId: number;
}

export async function ouvrirDossierSav(token: string, payload: OuvrirDossierSavPayload): Promise<DossierSav> {
  const reponse = await fetch(`${BASE}/sav/dossiers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<DossierSav>(reponse);
}

export async function affecterPieceSavRequete(
  token: string,
  idDossierSav: number,
  payload: { idProduit: number; quantite: number; userId: number }
): Promise<void> {
  const reponse = await fetch(`${BASE}/sav/dossiers/${idDossierSav}/pieces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  await lireJson(reponse);
}

export interface ChangerStatutSavPayload {
  nouveauStatut: StatutSav;
  userId: number;
  diagnostic?: string;
  motif?: string;
  montantMainOeuvre?: number;
  montantEncaisse?: number;
}

export async function changerStatutSavRequete(
  token: string,
  idDossierSav: number,
  payload: ChangerStatutSavPayload
): Promise<ChangerStatutSavResultat> {
  const reponse = await fetch(`${BASE}/sav/dossiers/${idDossierSav}/statut`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<ChangerStatutSavResultat>(reponse);
}

// 6.3 : sous-distributeurs et apporteurs d'affaires
export async function chargerApporteurs(token: string): Promise<Apporteur[]> {
  const reponse = await fetch(`${BASE}/apporteurs`, { headers: headersAuth(token) });
  return lireJson<Apporteur[]>(reponse);
}

export interface CreerApporteurPayload {
  nom: string;
  telephone?: string;
  tauxCommissionDefaut?: number;
}

export async function creerApporteurRequete(token: string, payload: CreerApporteurPayload): Promise<Apporteur> {
  const reponse = await fetch(`${BASE}/apporteurs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Apporteur>(reponse);
}

export async function modifierApporteurRequete(
  token: string,
  idApporteur: number,
  payload: { actif?: boolean; tauxCommissionDefaut?: number }
): Promise<Apporteur> {
  const reponse = await fetch(`${BASE}/apporteurs/${idApporteur}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Apporteur>(reponse);
}

export async function chargerFicheApporteur(token: string, idApporteur: number): Promise<FicheApporteur> {
  const reponse = await fetch(`${BASE}/apporteurs/${idApporteur}/fiche`, { headers: headersAuth(token) });
  return lireJson<FicheApporteur>(reponse);
}
