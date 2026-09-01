import type { Kit } from "@mboapilot/shared";

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
}

export interface NouvelAbonne {
  nom: string;
  prenom: string;
  telephone: string;
}

export interface RecrutementResultat {
  numeroAbonnement: number;
  idFacture: number;
  statutFacture: "BROUILLON" | "VALIDEE";
}
