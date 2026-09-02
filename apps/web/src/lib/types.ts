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

export interface Produit {
  idProduit: number;
  siteId: number;
  type: "BIEN" | "SERVICE" | "SAV" | "KIT";
  libelle: string;
  prixVente: number;
  coutRevient: number;
  margeType: "VALEUR" | "POURCENTAGE";
  margeValeur: number | null;
  margePourcentage: number | null;
  suiviStock: number;
  quantiteStock: number;
  seuilAlerte: number | null;
}

export interface EchangeMaterielResultat {
  idMateriel: number;
  idFacture: number;
  montantFacture: number;
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
