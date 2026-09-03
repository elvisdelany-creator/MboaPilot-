import type {
  AlerteEcheance,
  Abonne,
  Abonnement,
  Apporteur,
  CatalogueFamille,
  ChangerFormuleResultat,
  ChangerStatutSavResultat,
  CommissionCanalplusEnCours,
  ComptePartage,
  CompteUtilisateur,
  DossierSav,
  DossierSavDetaille,
  EchangeMaterielResultat,
  EntreeJournalAudit,
  Famille,
  FicheComptePartage,
  Fiche360,
  FicheApporteur,
  Formule,
  HistoriquePrixProduit,
  IndicateursJour,
  InfosEntreprise,
  KitBrut,
  MargeType,
  NouvelAbonne,
  OptionCatalogue,
  ParcoursPaiementMobile,
  PointEvolutionCA,
  Produit,
  RecrutementResultat,
  Role,
  Site,
  StatutSav,
  StockMouvement,
  TransactionMobileMoney,
  TypeProduit,
  Utilisateur,
  VentilationPaiement,
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

// 8.1 : fiche client 360°
export async function chargerFiche360(token: string, idAbonne: number): Promise<Fiche360> {
  const reponse = await fetch(`${BASE}/abonnes/${idAbonne}/fiche-360`, { headers: headersAuth(token) });
  return lireJson<Fiche360>(reponse);
}

export interface ModifierAbonnePayload {
  nom?: string;
  prenom?: string;
  telephone?: string;
  email?: string;
  numeroCni?: string;
  adresse?: string;
}

export async function modifierAbonneRequete(token: string, idAbonne: number, payload: ModifierAbonnePayload): Promise<Abonne> {
  const reponse = await fetch(`${BASE}/abonnes/${idAbonne}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Abonne>(reponse);
}

// 8.1 : fusion de doublons — opération destructrice, réservée à l'encadrement
export async function fusionnerAbonnesRequete(
  token: string,
  payload: { idAbonnePrincipal: number; idAbonneDoublon: number; userId: number }
): Promise<{ idAbonnePrincipal: number; idAbonneDoublon: number }> {
  const reponse = await fetch(`${BASE}/abonnes/fusion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson(reponse);
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
  idComptePartage?: number; // 5.9 : écran affecté sur un compte streaming mutualisé
}

export async function recruter(token: string, payload: RecruterPayload): Promise<RecrutementResultat> {
  const reponse = await fetch(`${BASE}/recrutements`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<RecrutementResultat>(reponse);
}

// 5.2, 7.3, 8.2 : catalogue des produits/pièces détachées, pour l'échange de matériel et sa gestion
export async function chargerProduits(token: string, siteId: number): Promise<Produit[]> {
  const reponse = await fetch(`${BASE}/produits?siteId=${siteId}`, { headers: headersAuth(token) });
  return lireJson<Produit[]>(reponse);
}

export interface CreerProduitPayload {
  siteId: number;
  type: TypeProduit;
  libelle: string;
  categorie?: string;
  prixVente: number;
  coutRevient?: number;
  margeType?: MargeType;
  margeValeur?: number;
  margePourcentage?: number;
  suiviStock?: boolean;
  seuilAlerte?: number;
}

export async function creerProduitRequete(token: string, payload: CreerProduitPayload): Promise<Produit> {
  const reponse = await fetch(`${BASE}/produits`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Produit>(reponse);
}

export interface ModifierProduitPayload {
  libelle?: string;
  categorie?: string;
  prixVente?: number;
  coutRevient?: number;
  margeType?: MargeType;
  margeValeur?: number;
  margePourcentage?: number;
  seuilAlerte?: number;
  userId: number;
}

export async function modifierProduitRequete(token: string, idProduit: number, payload: ModifierProduitPayload): Promise<Produit> {
  const reponse = await fetch(`${BASE}/produits/${idProduit}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Produit>(reponse);
}

export async function chargerHistoriquePrixProduit(token: string, idProduit: number): Promise<HistoriquePrixProduit[]> {
  const reponse = await fetch(`${BASE}/produits/${idProduit}/historique-prix`, { headers: headersAuth(token) });
  return lireJson<HistoriquePrixProduit[]>(reponse);
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

// 7.4 : changement de formule (migration) — abonnement ACTIF uniquement,
// formule de rang strictement supérieur, sans toucher aux dates de période.
export interface ChangerFormulePayload {
  siteId: number;
  userId: number;
  idNouvelleFormule: number;
  montantEncaisse: number;
}

export async function changerFormuleRequete(
  token: string,
  numeroAbonnement: number,
  payload: ChangerFormulePayload
): Promise<ChangerFormuleResultat> {
  const reponse = await fetch(`${BASE}/abonnements/${numeroAbonnement}/changement-formule`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<ChangerFormuleResultat>(reponse);
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

// 5.2 : suivi de stock — alertes de rupture, historique des mouvements, et
// les trois actions correctives (réception d'achat, casse/perte, inventaire)
export async function chargerAlertesStock(token: string, siteId: number): Promise<Produit[]> {
  const reponse = await fetch(`${BASE}/stock/alertes?siteId=${siteId}`, { headers: headersAuth(token) });
  return lireJson<Produit[]>(reponse);
}

export async function chargerMouvementsProduit(token: string, idProduit: number): Promise<StockMouvement[]> {
  const reponse = await fetch(`${BASE}/produits/${idProduit}/mouvements`, { headers: headersAuth(token) });
  return lireJson<StockMouvement[]>(reponse);
}

export interface ReceptionnerAchatPayload {
  idProduit: number;
  siteId: number;
  quantite: number;
  coutUnitaire: number;
  userId: number;
}

export async function receptionnerAchatRequete(token: string, payload: ReceptionnerAchatPayload): Promise<Produit> {
  const reponse = await fetch(`${BASE}/stock/achats`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Produit>(reponse);
}

export interface EnregistrerCassePayload {
  idProduit: number;
  siteId: number;
  quantite: number;
  motif: string;
  userId: number;
}

export async function enregistrerCasseRequete(token: string, payload: EnregistrerCassePayload): Promise<Produit> {
  const reponse = await fetch(`${BASE}/stock/casses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Produit>(reponse);
}

export interface AjusterInventairePayload {
  idProduit: number;
  siteId: number;
  quantiteComptee: number;
  motif: string;
  userId: number;
}

export async function ajusterInventaireRequete(token: string, payload: AjusterInventairePayload): Promise<Produit> {
  const reponse = await fetch(`${BASE}/stock/inventaires`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Produit>(reponse);
}

// 6.6 : paiement mobile (Orange Money et extensible)
export interface InitierPaiementMobilePayload {
  idFacture: number;
  numeroTelephone: string;
  montant: number;
  parcours: ParcoursPaiementMobile;
}

export async function initierPaiementMobileRequete(token: string, payload: InitierPaiementMobilePayload): Promise<TransactionMobileMoney> {
  const reponse = await fetch(`${BASE}/paiements-mobiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<TransactionMobileMoney>(reponse);
}

export async function chargerTransactionMobile(token: string, idTransaction: number): Promise<TransactionMobileMoney> {
  const reponse = await fetch(`${BASE}/paiements-mobiles/${idTransaction}`, { headers: headersAuth(token) });
  return lireJson<TransactionMobileMoney>(reponse);
}

// 6.6 : "polling ou callback/webhook" — sans webhook opérateur réel, la
// caisse interroge périodiquement ce point d'entrée.
export async function actualiserTransactionMobileRequete(token: string, idTransaction: number): Promise<TransactionMobileMoney> {
  const reponse = await fetch(`${BASE}/paiements-mobiles/${idTransaction}/actualiser`, {
    method: "POST",
    headers: headersAuth(token),
  });
  return lireJson<TransactionMobileMoney>(reponse);
}

// 8.6, 9.3 : tableau de bord de pilotage (Administrateur/Gérant/Comptable)
export async function chargerIndicateursJour(token: string, siteId: number, aujourdHui: string): Promise<IndicateursJour> {
  const reponse = await fetch(`${BASE}/tableau-bord/indicateurs?siteId=${siteId}&aujourdHui=${aujourdHui}`, { headers: headersAuth(token) });
  return lireJson<IndicateursJour>(reponse);
}

export async function chargerEvolutionCA(token: string, siteId: number, aujourdHui: string, jours: number): Promise<PointEvolutionCA[]> {
  const reponse = await fetch(`${BASE}/tableau-bord/evolution-ca?siteId=${siteId}&aujourdHui=${aujourdHui}&jours=${jours}`, {
    headers: headersAuth(token),
  });
  return lireJson<PointEvolutionCA[]>(reponse);
}

export async function chargerValorisationStock(token: string, siteId: number): Promise<number> {
  const reponse = await fetch(`${BASE}/tableau-bord/valorisation-stock?siteId=${siteId}`, { headers: headersAuth(token) });
  const { valorisation } = await lireJson<{ valorisation: number }>(reponse);
  return valorisation;
}

export async function chargerEncaissementsJour(token: string, siteId: number, aujourdHui: string): Promise<VentilationPaiement[]> {
  const reponse = await fetch(`${BASE}/tableau-bord/encaissements-jour?siteId=${siteId}&aujourdHui=${aujourdHui}`, { headers: headersAuth(token) });
  return lireJson<VentilationPaiement[]>(reponse);
}

export async function chargerCommissionsCanalplusEnCours(token: string, siteId: number): Promise<CommissionCanalplusEnCours[]> {
  const reponse = await fetch(`${BASE}/tableau-bord/commissions-canalplus?siteId=${siteId}`, { headers: headersAuth(token) });
  return lireJson<CommissionCanalplusEnCours[]>(reponse);
}

// 8.7 : gestion des comptes utilisateurs, des sites et journal d'audit —
// réservé à l'Administrateur
export async function chargerUtilisateurs(token: string): Promise<CompteUtilisateur[]> {
  const reponse = await fetch(`${BASE}/utilisateurs`, { headers: headersAuth(token) });
  return lireJson<CompteUtilisateur[]>(reponse);
}

export interface CreerCompteUtilisateurPayload {
  nom: string;
  prenom: string;
  identifiant: string;
  motDePasse: string;
  role: Role;
  siteId?: number;
}

export async function creerCompteUtilisateurRequete(token: string, payload: CreerCompteUtilisateurPayload): Promise<CompteUtilisateur> {
  const reponse = await fetch(`${BASE}/utilisateurs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<CompteUtilisateur>(reponse);
}

export async function modifierCompteUtilisateurRequete(
  token: string,
  idUser: number,
  payload: { actif?: boolean; role?: Role }
): Promise<CompteUtilisateur> {
  const reponse = await fetch(`${BASE}/utilisateurs/${idUser}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<CompteUtilisateur>(reponse);
}

export async function chargerSites(token: string): Promise<Site[]> {
  const reponse = await fetch(`${BASE}/sites`, { headers: headersAuth(token) });
  return lireJson<Site[]>(reponse);
}

export async function creerSiteRequete(token: string, payload: { nom: string; adresse?: string }): Promise<Site> {
  const reponse = await fetch(`${BASE}/sites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Site>(reponse);
}

export async function modifierSiteRequete(
  token: string,
  idSite: number,
  payload: { nom?: string; adresse?: string; actif?: boolean }
): Promise<Site> {
  const reponse = await fetch(`${BASE}/sites/${idSite}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Site>(reponse);
}

export async function chargerJournalAudit(token: string, tableCible?: string): Promise<EntreeJournalAudit[]> {
  const reponse = await fetch(`${BASE}/audit${tableCible ? `?tableCible=${tableCible}` : ""}`, { headers: headersAuth(token) });
  return lireJson<EntreeJournalAudit[]>(reponse);
}

// 8.8 : back-office catalogue — familles, formules, options (paramétrage
// sans intervention développeur), réservé à l'encadrement (gestionCatalogue)
export async function chargerFamilles(token: string): Promise<Famille[]> {
  const reponse = await fetch(`${BASE}/catalogue/familles`, { headers: headersAuth(token) });
  return lireJson<Famille[]>(reponse);
}

export async function creerFamilleRequete(token: string, payload: { libelle: string }): Promise<Famille> {
  const reponse = await fetch(`${BASE}/catalogue/familles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Famille>(reponse);
}

// toutes les formules de la famille, y compris désactivées (contrairement à
// chargerCatalogue, filtré actif = 1 pour la vente)
export async function chargerFormulesFamille(token: string, idFamille: number): Promise<Formule[]> {
  const reponse = await fetch(`${BASE}/catalogue/formules?idFamille=${idFamille}`, { headers: headersAuth(token) });
  return lireJson<Formule[]>(reponse);
}

export interface CreerFormulePayload {
  idFamille: number;
  libelle: string;
  prix: number;
  rang: number;
  modeDuree?: "STRICT_30J" | "MOIS_CIVIL";
  dureeCycles?: number;
}

export async function creerFormuleRequete(token: string, payload: CreerFormulePayload): Promise<Formule> {
  const reponse = await fetch(`${BASE}/catalogue/formules`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Formule>(reponse);
}

export interface ModifierFormulePayload {
  libelle?: string;
  prix?: number;
  rang?: number;
  modeDuree?: "STRICT_30J" | "MOIS_CIVIL";
  dureeCycles?: number;
  actif?: boolean;
}

export async function modifierFormuleRequete(token: string, idFormule: number, payload: ModifierFormulePayload): Promise<Formule> {
  const reponse = await fetch(`${BASE}/catalogue/formules/${idFormule}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<Formule>(reponse);
}

export async function chargerOptions(token: string): Promise<OptionCatalogue[]> {
  const reponse = await fetch(`${BASE}/catalogue/options`, { headers: headersAuth(token) });
  return lireJson<OptionCatalogue[]>(reponse);
}

export async function creerOptionRequete(token: string, payload: { libelle: string; prix: number }): Promise<OptionCatalogue> {
  const reponse = await fetch(`${BASE}/catalogue/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<OptionCatalogue>(reponse);
}

export async function modifierOptionRequete(token: string, idOption: number, payload: { libelle?: string; prix?: number }): Promise<OptionCatalogue> {
  const reponse = await fetch(`${BASE}/catalogue/options/${idOption}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<OptionCatalogue>(reponse);
}

export async function lierOptionFormuleRequete(
  token: string,
  payload: { idFormule: number; idOption: number; prixSurcharge?: number }
): Promise<void> {
  const reponse = await fetch(`${BASE}/catalogue/options/compat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  await lireJson(reponse);
}

export async function delierOptionFormuleRequete(token: string, idOption: number, idFormule: number): Promise<void> {
  const reponse = await fetch(`${BASE}/catalogue/options/${idOption}/compat/${idFormule}`, {
    method: "DELETE",
    headers: headersAuth(token),
  });
  if (!reponse.ok) {
    const corps = await reponse.json().catch(() => ({}));
    throw new Error(corps?.erreur ?? "Erreur inattendue");
  }
}

// 5.1.1, 8.8 : back-office des règles de prix dynamique des kits
export async function chargerKits(token: string, idFamille: number): Promise<KitBrut[]> {
  const reponse = await fetch(`${BASE}/catalogue/kits?idFamille=${idFamille}`, { headers: headersAuth(token) });
  return lireJson<KitBrut[]>(reponse);
}

export interface CreerKitPayload {
  idFamille: number;
  libelle: string;
  reglePrix: "PRIX_FIXE" | "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" | "PRIX_KIT_FIXE_PAR_DIFFERENTIEL";
  prixFixe?: number;
  prixParaboleAccessoires?: number;
  idFormuleReference?: number;
  prixKitReference?: number;
}

export async function creerKitRequete(token: string, payload: CreerKitPayload): Promise<KitBrut> {
  const reponse = await fetch(`${BASE}/catalogue/kits`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<KitBrut>(reponse);
}

export interface ModifierKitPayload {
  libelle?: string;
  reglePrix?: "PRIX_FIXE" | "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" | "PRIX_KIT_FIXE_PAR_DIFFERENTIEL";
  prixFixe?: number;
  prixParaboleAccessoires?: number;
  idFormuleReference?: number;
  prixKitReference?: number;
}

export async function modifierKitRequete(token: string, idKit: number, payload: ModifierKitPayload): Promise<KitBrut> {
  const reponse = await fetch(`${BASE}/catalogue/kits/${idKit}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<KitBrut>(reponse);
}

export async function definirPrixDecodeurKitRequete(
  token: string,
  payload: { idKit: number; idFormule: number; prixDecodeur: number }
): Promise<void> {
  const reponse = await fetch(`${BASE}/catalogue/kits/prix-decodeur`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  await lireJson(reponse);
}

export async function supprimerPrixDecodeurKitRequete(token: string, idKit: number, idFormule: number): Promise<void> {
  const reponse = await fetch(`${BASE}/catalogue/kits/${idKit}/prix-decodeur/${idFormule}`, {
    method: "DELETE",
    headers: headersAuth(token),
  });
  if (!reponse.ok) {
    const corps = await reponse.json().catch(() => ({}));
    throw new Error(corps?.erreur ?? "Erreur inattendue");
  }
}

// 6.7 : en-tête entreprise/site pour le ticket de caisse et la facture pro-forma
export async function chargerInfosEntreprise(token: string): Promise<InfosEntreprise> {
  const reponse = await fetch(`${BASE}/entreprise`, { headers: headersAuth(token) });
  return lireJson<InfosEntreprise>(reponse);
}

// 6.1, 6.2, 4.4, 8.8 : taux de TVA (le cas échéant), mentions légales des
// documents commerciaux, taux de commission vendeur par défaut et jalons d'alerte
export async function modifierEntrepriseRequete(
  token: string,
  payload: {
    tauxTva?: number | null;
    mentionsLegales?: string | null;
    tauxCommissionVendeurDefaut?: number | null;
    jalonAlerteUrgent?: number;
    jalonAlerteModere?: number;
    jalonAlerteAnticipe?: number;
  }
): Promise<InfosEntreprise["entreprise"]> {
  const reponse = await fetch(`${BASE}/entreprise`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<InfosEntreprise["entreprise"]>(reponse);
}

// 5.9 : comptes partagés streaming (Netflix, Prime Vidéo, IPTV…)
export async function chargerComptesPartages(token: string, siteId: number): Promise<ComptePartage[]> {
  const reponse = await fetch(`${BASE}/comptes-partages?siteId=${siteId}`, { headers: headersAuth(token) });
  return lireJson<ComptePartage[]>(reponse);
}

export interface CreerComptePartagePayload {
  siteId: number;
  idFamille: number;
  libelle: string;
  identifiant?: string;
  motDePasse?: string;
  nombreEcransMax: number;
}

export async function creerComptePartageRequete(token: string, payload: CreerComptePartagePayload): Promise<ComptePartage> {
  const reponse = await fetch(`${BASE}/comptes-partages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<ComptePartage>(reponse);
}

export interface ModifierComptePartagePayload {
  libelle?: string;
  identifiant?: string;
  motDePasse?: string;
  nombreEcransMax?: number;
  actif?: boolean;
}

export async function modifierComptePartageRequete(token: string, idComptePartage: number, payload: ModifierComptePartagePayload): Promise<ComptePartage> {
  const reponse = await fetch(`${BASE}/comptes-partages/${idComptePartage}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headersAuth(token) },
    body: JSON.stringify(payload),
  });
  return lireJson<ComptePartage>(reponse);
}

export async function chargerFicheComptePartage(token: string, idComptePartage: number): Promise<FicheComptePartage> {
  const reponse = await fetch(`${BASE}/comptes-partages/${idComptePartage}/fiche`, { headers: headersAuth(token) });
  return lireJson<FicheComptePartage>(reponse);
}
