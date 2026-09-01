import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = sql`(datetime('now'))`;

// --- 3.2.1 Référentiel entreprise, sites et utilisateurs ---

export const entreprise = sqliteTable("entreprise", {
  idEntreprise: integer("id_entreprise").primaryKey({ autoIncrement: true }),
  nom: text("nom").notNull(),
  devise: text("devise").notNull().default("XAF"),
  logoUrl: text("logo_url"),
  dateCreation: text("date_creation").notNull().default(now),
});

export const site = sqliteTable("site", {
  idSite: integer("id_site").primaryKey({ autoIncrement: true }),
  idEntreprise: integer("id_entreprise").notNull().references(() => entreprise.idEntreprise),
  nom: text("nom").notNull(),
  adresse: text("adresse"),
  actif: integer("actif").notNull().default(1),
});

// rôles définis en 2.5.1 : ADMINISTRATEUR, GERANT, CAISSIER, TECHNICIEN_SAV, COMPTABLE, APPORTEUR
export const utilisateur = sqliteTable("utilisateur", {
  idUser: integer("id_user").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").notNull().references(() => site.idSite),
  nom: text("nom").notNull(),
  prenom: text("prenom").notNull(),
  identifiant: text("identifiant").notNull(),
  motDePasseHash: text("mot_de_passe_hash").notNull(),
  role: text("role", {
    enum: ["ADMINISTRATEUR", "GERANT", "CAISSIER", "TECHNICIEN_SAV", "COMPTABLE", "APPORTEUR"],
  }).notNull(),
  actif: integer("actif").notNull().default(1),
  dateCreation: text("date_creation").notNull().default(now),
}, (t) => ({
  identifiantUnique: uniqueIndex("idx_utilisateur_identifiant").on(t.identifiant),
}));

// tiers apporteur d'affaires — 6.3
export const sousDistributeur = sqliteTable("sous_distributeur", {
  idApporteur: integer("id_apporteur").primaryKey({ autoIncrement: true }),
  nom: text("nom").notNull(),
  telephone: text("telephone"),
  tauxCommissionDefaut: integer("taux_commission_defaut_pourmille"), // taux en pour-mille pour éviter les flottants
  actif: integer("actif").notNull().default(1),
});

// --- 3.2.2 Abonnés, abonnements et catalogue ---

export const abonne = sqliteTable("abonne", {
  idAbonne: integer("id_abonne").primaryKey({ autoIncrement: true }), // pérenne, ne change jamais (4.5)
  siteId: integer("site_id").notNull().references(() => site.idSite),
  nom: text("nom").notNull(),
  prenom: text("prenom").notNull(),
  email: text("email"),
  numeroCni: text("numero_cni"),
  adresse: text("adresse"),
  telephone: text("telephone").notNull(),
  // non modifiable après création sans droit administrateur (6.3) : à faire respecter côté API, pas ici
  apporteurId: integer("apporteur_id").references(() => sousDistributeur.idApporteur),
  dateCreation: text("date_creation").notNull().default(now),
}, (t) => ({
  telephoneIdx: index("idx_abonne_telephone").on(t.telephone),
}));

export const familleAbonnement = sqliteTable("famille_abonnement", {
  idFamille: integer("id_famille").primaryKey({ autoIncrement: true }),
  libelle: text("libelle").notNull().unique(), // CANAL+, DSTV, STARTIMES, 24H_SPORT, MOREPLEX, STREAMING
});

export const formule = sqliteTable("formule", {
  idFormule: integer("id_formule").primaryKey({ autoIncrement: true }),
  idFamille: integer("id_famille").notNull().references(() => familleAbonnement.idFamille),
  libelle: text("libelle").notNull(),
  prix: integer("prix").notNull(), // FCFA
  rang: integer("rang").notNull(), // ordre croissant = hiérarchie pour la migration (7.4)
  modeDuree: text("mode_duree", { enum: ["STRICT_30J", "MOIS_CIVIL"] }).notNull().default("STRICT_30J"), // 4.1
  dureeCycles: integer("duree_cycles").notNull().default(1), // nb de cycles de 30j (ou mois civils)
  actif: integer("actif").notNull().default(1),
});

export const optionComplement = sqliteTable("option_complement", {
  idOption: integer("id_option").primaryKey({ autoIncrement: true }),
  libelle: text("libelle").notNull(),
  prix: integer("prix").notNull(),
});

export const formuleOptionCompat = sqliteTable("formule_option_compat", {
  idFormule: integer("id_formule").notNull().references(() => formule.idFormule),
  idOption: integer("id_option").notNull().references(() => optionComplement.idOption),
  prixSurcharge: integer("prix_surcharge"), // NULL = utilise le prix par défaut de l'option
}, (t) => ({
  pk: primaryKey({ columns: [t.idFormule, t.idOption] }),
}));

// règles de prix dynamique du kit — 5.1.1
export const kit = sqliteTable("kit", {
  idKit: integer("id_kit").primaryKey({ autoIncrement: true }),
  idFamille: integer("id_famille").notNull().references(() => familleAbonnement.idFamille),
  libelle: text("libelle").notNull(),
  reglePrix: text("regle_prix", {
    enum: ["PRIX_FIXE", "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", "PRIX_KIT_FIXE_PAR_DIFFERENTIEL"],
  }).notNull(),
  prixFixe: integer("prix_fixe"), // utilisé si regle_prix = PRIX_FIXE
  prixParaboleAccessoires: integer("prix_parabole_accessoires").notNull().default(0), // partie fixe, PRIX_DECODEUR_VARIABLE_SELON_FORMULE (5.1.1)
  idFormuleReference: integer("id_formule_reference").references(() => formule.idFormule), // pour PRIX_KIT_FIXE_PAR_DIFFERENTIEL
  prixKitReference: integer("prix_kit_reference"), // prix du kit à la formule de référence, pour PRIX_KIT_FIXE_PAR_DIFFERENTIEL
});

export const kitPrixDecodeur = sqliteTable("kit_prix_decodeur", {
  idKit: integer("id_kit").notNull().references(() => kit.idKit),
  idFormule: integer("id_formule").notNull().references(() => formule.idFormule),
  prixDecodeur: integer("prix_decodeur").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.idKit, t.idFormule] }),
}));

export const abonnement = sqliteTable("abonnement", {
  numeroAbonnement: integer("numero_abonnement").primaryKey({ autoIncrement: true }), // peut changer (échange matériel, 7.3)
  idAbonne: integer("id_abonne").notNull().references(() => abonne.idAbonne),
  idFormule: integer("id_formule").notNull().references(() => formule.idFormule),
  siteId: integer("site_id").notNull().references(() => site.idSite),
  dateDebut: text("date_debut").notNull(), // ISO 'YYYY-MM-DD'
  dateFin: text("date_fin").notNull(), // calculée selon 4.1, jamais saisie directement
  statut: text("statut", { enum: ["ACTIF", "EXPIRE", "RESILIE"] }).notNull().default("ACTIF"), // 4.3
  apporteurId: integer("apporteur_id").references(() => sousDistributeur.idApporteur),
  creePar: integer("cree_par").notNull().references(() => utilisateur.idUser),
  dateCreation: text("date_creation").notNull().default(now),
}, (t) => ({
  // pièce technique centrale du tableau de bord d'alertes J-7/J-3/J-1 (4.4)
  echeanceIdx: index("idx_abonnement_echeance").on(t.dateFin, t.statut),
  abonneIdx: index("idx_abonnement_abonne").on(t.idAbonne),
}));

export const materielAbonne = sqliteTable("materiel_abonne", {
  idMateriel: integer("id_materiel").primaryKey({ autoIncrement: true }),
  numeroAbonnement: integer("numero_abonnement").notNull().references(() => abonnement.numeroAbonnement),
  typeMateriel: text("type_materiel").notNull(), // ex. DECODEUR, PARABOLE, CARTE_ACCES
  numeroSerie: text("numero_serie"),
  statut: text("statut", { enum: ["ACTIF", "REMPLACE"] }).notNull().default("ACTIF"),
  dateInstallation: text("date_installation").notNull().default(now),
});

// trace chaque changement de formule/option/matériel sur un abonnement (3.2.2)
export const historiqueAbonnement = sqliteTable("historique_abonnement", {
  idHisto: integer("id_histo").primaryKey({ autoIncrement: true }),
  numeroAbonnement: integer("numero_abonnement").notNull().references(() => abonnement.numeroAbonnement),
  typeChangement: text("type_changement", {
    enum: ["FORMULE", "OPTION", "MATERIEL", "STATUT"],
  }).notNull(),
  valeurAvant: text("valeur_avant"),
  valeurApres: text("valeur_apres"),
  motif: text("motif"),
  utilisateurId: integer("utilisateur_id").references(() => utilisateur.idUser), // NULL = job automatique (4.3)
  dateChangement: text("date_changement").notNull().default(now),
});

// suivi de la période probatoire de 4 mois (119 jours) sur un recrutement CANAL+ — 6.2
export const suiviCommissionCanalplus = sqliteTable("suivi_commission_canalplus", {
  idSuivi: integer("id_suivi").primaryKey({ autoIncrement: true }),
  numeroAbonnement: integer("numero_abonnement").notNull().references(() => abonnement.numeroAbonnement),
  vendeurId: integer("vendeur_id").references(() => utilisateur.idUser),
  apporteurId: integer("apporteur_id").references(() => sousDistributeur.idApporteur),
  montantCommission: integer("montant_commission").notNull(),
  dateFinProbatoire: text("date_fin_probatoire").notNull(),
  statut: text("statut", { enum: ["EN_COURS", "CONFIRMEE", "ANNULEE"] }).notNull().default("EN_COURS"),
});

// journal des alertes d'échéance envoyées par le job quotidien (4.4, 8.3).
// Le canal de diffusion effectif (SMS/e-mail, 13.2) est un point d'extension
// futur, non câblé pour l'instant — ceci enregistre uniquement le jalon atteint.
export const alerteEcheance = sqliteTable("alerte_echeance", {
  idAlerte: integer("id_alerte").primaryKey({ autoIncrement: true }),
  numeroAbonnement: integer("numero_abonnement").notNull().references(() => abonnement.numeroAbonnement),
  jalon: text("jalon", { enum: ["J-7", "J-3", "J-1"] }).notNull(),
  dateDeclenchement: text("date_declenchement").notNull(),
  dateCreation: text("date_creation").notNull().default(now),
}, (t) => ({
  // idempotence : le job peut tourner plusieurs fois le même jour sans dupliquer l'alerte
  uniqueParJalon: uniqueIndex("idx_alerte_unique").on(t.numeroAbonnement, t.jalon, t.dateDeclenchement),
}));

// --- 3.2.3 Catalogue commercial, ventes et finance ---

export const produit = sqliteTable("produit", {
  idProduit: integer("id_produit").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").notNull().references(() => site.idSite),
  type: text("type", { enum: ["BIEN", "SERVICE", "SAV", "KIT"] }).notNull(),
  libelle: text("libelle").notNull(),
  prixVente: integer("prix_vente").notNull(),
  coutRevient: integer("cout_revient").notNull().default(0),
  margeType: text("marge_type", { enum: ["VALEUR", "POURCENTAGE"] }).notNull().default("VALEUR"), // 6.1
  margeValeur: integer("marge_valeur"),
  margePourcentage: integer("marge_pourcentage"), // en pour-mille, ex. 1500 = 15.00%
  suiviStock: integer("suivi_stock").notNull().default(0), // 0/1 — false pour SERVICE/SAV
  quantiteStock: integer("quantite_stock").notNull().default(0), // cache maintenu par stock_mouvement
  seuilAlerte: integer("seuil_alerte"),
});

export const stockMouvement = sqliteTable("stock_mouvement", {
  idMouvement: integer("id_mouvement").primaryKey({ autoIncrement: true }),
  idProduit: integer("id_produit").notNull().references(() => produit.idProduit),
  siteId: integer("site_id").notNull().references(() => site.idSite),
  typeMouvement: text("type_mouvement", {
    enum: ["ACHAT", "VENTE", "CASSE", "TRANSFERT_ENTREE", "TRANSFERT_SORTIE", "INVENTAIRE"],
  }).notNull(),
  quantite: integer("quantite").notNull(),
  motif: text("motif"), // obligatoire côté API pour CASSE/INVENTAIRE (5.2)
  dateMouvement: text("date_mouvement").notNull().default(now),
  utilisateurId: integer("utilisateur_id").notNull().references(() => utilisateur.idUser),
});

export const facture = sqliteTable("facture", {
  idFacture: integer("id_facture").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").notNull().references(() => site.idSite),
  idAbonne: integer("id_abonne").references(() => abonne.idAbonne),
  statut: text("statut", { enum: ["BROUILLON", "VALIDEE"] }).notNull().default("BROUILLON"), // jamais imprimable en BROUILLON (6.4)
  montantTotal: integer("montant_total").notNull().default(0),
  creePar: integer("cree_par").notNull().references(() => utilisateur.idUser),
  dateCreation: text("date_creation").notNull().default(now),
});

export const ligneVente = sqliteTable("ligne_vente", {
  idLigne: integer("id_ligne").primaryKey({ autoIncrement: true }),
  idFacture: integer("id_facture").notNull().references(() => facture.idFacture),
  idProduit: integer("id_produit").references(() => produit.idProduit),
  idKit: integer("id_kit").references(() => kit.idKit), // kit vendu (5.1.1) — distinct du produit stocké
  numeroAbonnement: integer("numero_abonnement").references(() => abonnement.numeroAbonnement),
  quantite: integer("quantite").notNull().default(1),
  prixApplique: integer("prix_applique").notNull(),
});

export const paiement = sqliteTable("paiement", {
  idPaiement: integer("id_paiement").primaryKey({ autoIncrement: true }),
  idFacture: integer("id_facture").notNull().references(() => facture.idFacture),
  mode: text("mode", { enum: ["CASH", "CHEQUE", "VIREMENT", "MOBILE_MONEY"] }).notNull(),
  montant: integer("montant").notNull(),
  referenceTransaction: text("reference_transaction"), // clé d'idempotence MOBILE_MONEY (13.2)
  datePaiement: text("date_paiement").notNull().default(now),
}, (t) => ({
  // idempotence des callbacks Orange Money : un même événement ne doit jamais créer deux paiements
  referenceUnique: uniqueIndex("idx_paiement_reference").on(t.referenceTransaction),
}));

export const savDossier = sqliteTable("sav_dossier", {
  idDossierSav: integer("id_dossier_sav").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").notNull().references(() => site.idSite),
  idAbonne: integer("id_abonne").references(() => abonne.idAbonne), // nullable : client non-abonné
  descriptionPanne: text("description_panne").notNull(),
  etatReception: text("etat_reception"),
  diagnostic: text("diagnostic"),
  statut: text("statut", {
    enum: ["RECU", "DIAGNOSTIC", "DEVIS_ATTENTE", "REPARATION", "PRET", "LIVRE", "IRREPARABLE", "ABANDONNE"],
  }).notNull().default("RECU"),
  sousGarantie: integer("sous_garantie").notNull().default(0),
  dateReception: text("date_reception").notNull().default(now),
});

// journal d'audit immuable — 11.5 : jamais de UPDATE/DELETE applicatif sur cette table
export const journalAudit = sqliteTable("journal_audit", {
  idAudit: integer("id_audit").primaryKey({ autoIncrement: true }),
  utilisateurId: integer("utilisateur_id").notNull().references(() => utilisateur.idUser),
  action: text("action", { enum: ["CREATION", "MODIFICATION", "SUPPRESSION"] }).notNull(),
  tableCible: text("table_cible").notNull(),
  idCible: text("id_cible").notNull(),
  valeurAvant: text("valeur_avant"), // JSON sérialisé
  valeurApres: text("valeur_apres"), // JSON sérialisé
  dateAction: text("date_action").notNull().default(now),
}, (t) => ({
  cibleIdx: index("idx_audit_cible").on(t.tableCible, t.idCible),
}));
