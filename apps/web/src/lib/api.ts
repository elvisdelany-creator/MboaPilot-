import type { AlerteEcheance, Abonne, Abonnement, CatalogueFamille, NouvelAbonne, RecrutementResultat, Utilisateur } from "./types";

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
}

export async function recruter(token: string, payload: RecruterPayload): Promise<RecrutementResultat> {
  const reponse = await fetch(`${BASE}/recrutements`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<RecrutementResultat>(reponse);
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
