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

export type JalonAlerte = "J-7" | "J-3" | "J-1";

export interface AlerteEcheance {
  numeroAbonnement: number;
  jalon: JalonAlerte;
  joursRestants: number;
  dateFin: string;
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

export interface DossierSavDetaille extends DossierSav {
  pieces: SavPieceUtilisee[];
  historique: SavHistoriqueEntree[];
  facture: { idFacture: number; statut: "BROUILLON" | "VALIDEE"; montantTotal: number } | null;
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

export interface FicheApporteur {
  apporteur: Apporteur;
  abonnes: Abonne[];
  chiffreAffaires: number;
  commissionsCanalplus: SuiviCommissionCanalplus[];
}

export type TypeMouvementStock = "ACHAT" | "VENTE" | "CASSE" | "TRANSFERT_ENTREE" | "TRANSFERT_SORTIE" | "INVENTAIRE";

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

export interface Fiche360 {
  abonne: Abonne;
  apporteur: Apporteur | null;
  abonnements: AbonnementAvecFormule[];
  materiels: MaterielAbonne[];
  factures: Facture[];
  paiements: Paiement[];
  dossiersSav: DossierSav[];
  commissionsCanalplus: SuiviCommissionCanalplus[];
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
