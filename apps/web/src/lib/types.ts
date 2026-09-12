import type { Kit, StatutSav } from "@mboapilot/shared";

export type { StatutSav };

export interface Abonne {
  idAbonne: number;
  siteId: number;
  nom: string;
  prenom: string;
  email: string | null;
  numeroCni: string | null;
  adresse: string | null;
  telephone: string;
  apporteurId: number | null;
  dateCreation: string;
}

export interface Formule {
  idFormule: number;
  idFamille: number;
  libelle: string;
  prix: number;
  rang: number;
  modeDuree: "STRICT_30J" | "MOIS_CIVIL";
  dureeCycles: number;
  actif: number;
}

export type CatalogueKit = Kit & { idKit: number; idFamille: number; libelle: string };

// 5.1.1, 8.8 : ligne brute d'un kit pour le back-office (à la différence de
// CatalogueKit, qui est enrichi/calculé pour la vente)
export interface KitBrut {
  idKit: number;
  idFamille: number;
  libelle: string;
  reglePrix: "PRIX_FIXE" | "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" | "PRIX_KIT_FIXE_PAR_DIFFERENTIEL";
  prixFixe: number | null;
  prixParaboleAccessoires: number;
  idFormuleReference: number | null;
  prixKitReference: number | null;
}

export interface CatalogueFamille {
  idFamille: number;
  libelle: string;
  formules: Formule[];
  kits: CatalogueKit[];
}

// 8.8 : back-office catalogue — famille au sens administratif (sans les
// formules/kits imbriqués, contrairement à CatalogueFamille qui sert la vente)
export interface Famille {
  idFamille: number;
  libelle: string;
}

export interface OptionCatalogue {
  idOption: number;
  libelle: string;
  prix: number;
  formulesCompatibles: { idFormule: number; prixSurcharge: number | null }[];
}

// 6.7 : en-tête des documents commerciaux (ticket de caisse, pro-forma)
export interface InfosEntreprise {
  entreprise: {
    idEntreprise: number;
    nom: string;
    devise: string;
    logoUrl: string | null;
    // 6.1, 8.8 : taux en centièmes de %, ex. 1925 = 19,25 % ; null = pas de taxe applicable
    tauxTva: number | null;
    mentionsLegales: string | null;
    // 6.2, 8.8 : taux en pour-mille, comme ComptePartage/apporteur ; null = non configuré
    tauxCommissionVendeurDefaut: number | null;
    // 4.4, 8.8 : jalons d'alerte d'échéance, en jours (par défaut 1/3/7)
    jalonAlerteUrgent: number;
    jalonAlerteModere: number;
    jalonAlerteAnticipe: number;
    // 4.4, 8.8 : durée (jours) de rétention des abonnements EXPIRE dans la
    // liste dédiée du tableau de bord (défaut 90)
    dureeRetentionExpiresJours: number;
    // 11.2, 8.8 : politique de complexité minimale du mot de passe, configurable
    politiqueMdpLongueurMin: number;
    politiqueMdpExigerMajuscule: boolean;
    politiqueMdpExigerChiffre: boolean;
    politiqueMdpExigerCaractereSpecial: boolean;
    // 11.3, 8.8 : durée (jours) de conservation des données d'un abonné
    // inactif avant anonymisation automatique (défaut 1095 = 3 ans)
    dureeConservationDonneesJours: number;
    // 4.3, 8.8 : "délai de grâce" (jours) — un réabonnement tardif dans ce
    // délai après la date_fin théorique redémarre à cette date_fin plutôt
    // que la date réelle de paiement (défaut 0 = comportement inchangé)
    delaiGraceReabonnementJours: number;
    // 5.10, 7.3, 8.8 : "sous garantie (gratuit ou tarif réduit selon la
    // politique)" — taux appliqué au tarif plein (0 = gratuit par défaut)
    tauxGarantiePourcent: number;
  };
  site: { idSite: number; nom: string; adresse: string | null };
}

// 5.9 : compte fournisseur mutualisé (Netflix, Prime Vidéo, IPTV…)
export interface ComptePartage {
  idComptePartage: number;
  siteId: number;
  idFamille: number;
  libelle: string;
  identifiant: string | null;
  motDePasse: string | null;
  nombreEcransMax: number;
  actif: number;
  ecransOccupes: number;
}

export interface FicheComptePartage {
  compte: ComptePartage;
  occupants: { numeroAbonnement: number; statut: "ACTIF" | "EXPIRE" | "RESILIE"; dateFin: string; abonne: Abonne }[];
}

export interface Abonnement {
  numeroAbonnement: number;
  idAbonne: number;
  idFormule: number;
  siteId: number;
  dateDebut: string;
  dateFin: string;
  statut: "ACTIF" | "EXPIRE" | "RESILIE";
  apporteurId: number | null;
  creePar: number;
  dateCreation: string;
}

// 4.4, 8.8 : jalons d'alerte paramétrables (par défaut J-7/J-3/J-1) — jalon
// est le nombre de jours du seuil atteint, rang classe l'urgence (1 = le
// plus urgent) indépendamment des valeurs configurées, pour un affichage
// (couleur, tri) stable même si les seuils changent.
export interface AlerteEcheance {
  numeroAbonnement: number;
  jalon: number;
  rang: 1 | 2 | 3;
  joursRestants: number;
  dateFin: string;
  abonne: Abonne;
  formule: Formule;
}

// 4.4, 8.8 : liste dédiée « Abonnements expirés » du tableau de bord, pour
// les campagnes de reconquête — bornée par une durée de rétention paramétrable
export interface AbonnementExpire {
  numeroAbonnement: number;
  dateFin: string;
  joursDepuisExpiration: number;
  abonne: Abonne;
  formule: Formule;
}

export type Role = "ADMINISTRATEUR" | "GERANT" | "CAISSIER" | "TECHNICIEN_SAV" | "COMPTABLE" | "APPORTEUR";

export interface Utilisateur {
  idUser: number;
  siteId: number;
  nom: string;
  prenom: string;
  identifiant: string;
  role: Role;
  idApporteur: number | null;
}

// 8.7 : compte géré depuis l'administration (distinct de Utilisateur, qui
// est le profil renvoyé à la connexion — celui-ci porte en plus le statut
// actif/inactif consultable par un administrateur)
export interface CompteUtilisateur {
  idUser: number;
  siteId: number;
  nom: string;
  prenom: string;
  identifiant: string;
  role: Role;
  idApporteur: number | null;
  actif: number;
  dateCreation: string;
}

export interface Site {
  idSite: number;
  idEntreprise: number;
  nom: string;
  adresse: string | null;
  actif: number;
}

export interface EntreeJournalAudit {
  idAudit: number;
  utilisateurId: number;
  utilisateurNom: string;
  utilisateurPrenom: string;
  action: "CREATION" | "MODIFICATION" | "SUPPRESSION";
  tableCible: string;
  idCible: string;
  valeurAvant: string | null;
  valeurApres: string | null;
  dateAction: string;
}

export interface NouvelAbonne {
  nom: string;
  prenom: string;
  telephone: string;
  apporteurId?: number; // 6.3 : lien permanent renseigné à la création, non modifiable ensuite
}

export interface RecrutementResultat {
  numeroAbonnement: number;
  idFacture: number;
  statutFacture: "BROUILLON" | "VALIDEE";
}

export type TypeProduit = "BIEN" | "SERVICE" | "SAV" | "KIT";
export type MargeType = "VALEUR" | "POURCENTAGE";

export interface Produit {
  idProduit: number;
  siteId: number;
  type: TypeProduit;
  libelle: string;
  categorie: string | null;
  codeBarres: string | null;
  prixVente: number;
  coutRevient: number;
  margeType: MargeType;
  margeValeur: number | null;
  margePourcentage: number | null;
  suiviStock: number;
  quantiteStock: number;
  seuilAlerte: number | null;
}

export interface HistoriquePrixProduit {
  idHistoPrix: number;
  idProduit: number;
  prixVenteAvant: number;
  prixVenteApres: number;
  coutRevientAvant: number;
  coutRevientApres: number;
  utilisateurId: number;
  dateChangement: string;
}

export interface EchangeMaterielResultat {
  idMateriel: number;
  idFacture: number;
  montantFacture: number;
  statutFacture: "BROUILLON" | "VALIDEE";
}

export interface ChangerFormuleResultat {
  numeroAbonnement: number;
  idFacture: number;
  montantDifferentiel: number;
  statutFacture: "BROUILLON" | "VALIDEE";
}

export interface DossierSav {
  idDossierSav: number;
  siteId: number;
  idAbonne: number | null;
  clientNom: string | null;
  clientTelephone: string | null;
  descriptionPanne: string;
  etatReception: string | null;
  diagnostic: string | null;
  statut: StatutSav;
  sousGarantie: number;
  montantMainOeuvre: number;
  idFacture: number | null;
  dateReception: string;
}

export interface SavPieceUtilisee {
  idPieceUtilisee: number;
  idDossierSav: number;
  idProduit: number;
  quantite: number;
}

export interface SavHistoriqueEntree {
  idHistoSav: number;
  idDossierSav: number;
  statutAvant: StatutSav | null;
  statutApres: StatutSav;
  motif: string | null;
  utilisateurId: number | null;
  dateChangement: string;
}

// 5.10 : "photos optionnelles" du dossier SAV
export interface SavPhoto {
  idPhoto: number;
  idDossierSav: number;
  nomFichier: string;
  nomFichierOriginal: string;
  typeMime: string;
  dateAjout: string;
}

export interface DossierSavDetaille extends DossierSav {
  pieces: SavPieceUtilisee[];
  historique: SavHistoriqueEntree[];
  facture: { idFacture: number; statut: "BROUILLON" | "VALIDEE"; montantTotal: number } | null;
  photos: SavPhoto[];
}

export interface ChangerStatutSavResultat {
  idDossierSav: number;
  statut: StatutSav;
  idFacture: number | null;
  montantFacture: number | null;
  statutFacture: "BROUILLON" | "VALIDEE" | null;
}

export interface Apporteur {
  idApporteur: number;
  nom: string;
  telephone: string | null;
  tauxCommissionDefaut: number | null;
  actif: number;
}

export type StatutCommission = "EN_COURS" | "CONFIRMEE" | "ANNULEE";

export interface SuiviCommissionCanalplus {
  idSuivi: number;
  numeroAbonnement: number;
  vendeurId: number | null;
  apporteurId: number | null;
  montantCommission: number;
  dateFinProbatoire: string;
  statut: StatutCommission;
}

// 6.3 : "historique de règlement de ses commissions" — paiement effectivement
// versé à l'apporteur, distinct du simple constat CONFIRMEE/ANNULEE (6.2)
export interface ReglementCommission {
  idReglement: number;
  apporteurId: number;
  montant: number;
  modePaiement: ModePaiement;
  reference: string | null;
  utilisateurId: number;
  dateReglement: string;
}

export interface FicheApporteur {
  apporteur: Apporteur;
  abonnes: Abonne[];
  chiffreAffaires: number;
  commissionsCanalplus: SuiviCommissionCanalplus[];
  reglements: ReglementCommission[];
  montantCommissionConfirmee: number;
  montantCommissionRegle: number;
  soldeCommissionDu: number;
}

export type TypeMouvementStock = "ACHAT" | "VENTE" | "CASSE" | "TRANSFERT_ENTREE" | "TRANSFERT_SORTIE" | "INVENTAIRE" | "RETOUR_CLIENT";

export interface StockMouvement {
  idMouvement: number;
  idProduit: number;
  siteId: number;
  typeMouvement: TypeMouvementStock;
  quantite: number;
  motif: string | null;
  dateMouvement: string;
  utilisateurId: number;
}

export type ParcoursPaiementMobile = "USSD_CLIENT" | "PUSH_MARCHAND";
export type StatutPaiementMobile = "INITIEE" | "EN_ATTENTE" | "REUSSIE" | "ECHOUEE" | "EXPIREE";

export interface TransactionMobileMoney {
  idTransaction: number;
  idFacture: number;
  parcours: ParcoursPaiementMobile;
  numeroTelephone: string;
  montant: number;
  statut: StatutPaiementMobile;
  referenceTransaction: string | null;
  dateCreation: string;
  dateExpiration: string;
}

// 8.1 : fiche client 360°
export interface Facture {
  idFacture: number;
  siteId: number;
  idAbonne: number | null;
  statut: "BROUILLON" | "VALIDEE";
  // 6.4 : une facture de type AVOIR corrige une facture VENTE (factureOrigineId), montant négatif
  type: "VENTE" | "AVOIR";
  factureOrigineId: number | null;
  montantTotal: number;
  creePar: number;
  dateCreation: string;
}

export interface MaterielAbonne {
  idMateriel: number;
  numeroAbonnement: number;
  typeMateriel: string;
  numeroSerie: string | null;
  statut: "ACTIF" | "REMPLACE";
  dateInstallation: string;
}

export interface AbonnementAvecFormule {
  numeroAbonnement: number;
  idFormule: number;
  idFamille: number;
  formuleLibelle: string;
  familleLibelle: string;
  dateDebut: string;
  dateFin: string;
  statut: "ACTIF" | "EXPIRE" | "RESILIE";
}

export interface Paiement {
  idPaiement: number;
  idFacture: number;
  mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";
  montant: number;
  referenceTransaction: string | null;
  datePaiement: string;
}

// 4.4, 8.3, 8.4 : notification client (SMS/e-mail) envoyée pour une alerte
// d'échéance ou un dossier SAV passé au statut « Prêt »
export interface Notification {
  idNotification: number;
  idAbonne: number;
  canal: "SMS" | "EMAIL";
  evenement: "ALERTE_ECHEANCE" | "SAV_PRET";
  destinataire: string;
  message: string;
  statutEnvoi: "ENVOYEE" | "ECHOUEE";
  idAlerte: number | null;
  idDossierSav: number | null;
  dateEnvoi: string;
}

export interface Fiche360 {
  abonne: Abonne;
  apporteur: Apporteur | null;
  abonnements: AbonnementAvecFormule[];
  materiels: MaterielAbonne[];
  factures: Facture[];
  paiements: Paiement[];
  dossiersSav: DossierSav[];
  commissionsCanalplus: SuiviCommissionCanalplus[];
  notifications: Notification[];
}

// 8.6, 9.3 : tableau de bord de pilotage
export interface IndicateursJour {
  chiffreAffairesJour: number;
  margeEstimeeJour: number;
  nombreEcheances7j: number;
  nombreAlertesStock: number;
}

export interface PointEvolutionCA {
  date: string;
  montant: number;
}

export type ModePaiement = "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY";

export interface VentilationPaiement {
  mode: ModePaiement;
  total: number;
}

export interface CommissionCanalplusEnCours {
  commission: SuiviCommissionCanalplus;
  abonnement: Abonnement;
  abonne: Abonne;
}
