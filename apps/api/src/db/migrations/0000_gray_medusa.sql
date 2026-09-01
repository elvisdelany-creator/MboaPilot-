CREATE TABLE `abonne` (
	`id_abonne` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`nom` text NOT NULL,
	`prenom` text NOT NULL,
	`email` text,
	`numero_cni` text,
	`adresse` text,
	`telephone` text NOT NULL,
	`apporteur_id` integer,
	`date_creation` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id_site`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`apporteur_id`) REFERENCES `sous_distributeur`(`id_apporteur`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_abonne_telephone` ON `abonne` (`telephone`);--> statement-breakpoint
CREATE TABLE `abonnement` (
	`numero_abonnement` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_abonne` integer NOT NULL,
	`id_formule` integer NOT NULL,
	`site_id` integer NOT NULL,
	`date_debut` text NOT NULL,
	`date_fin` text NOT NULL,
	`statut` text DEFAULT 'ACTIF' NOT NULL,
	`apporteur_id` integer,
	`cree_par` integer NOT NULL,
	`date_creation` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`id_abonne`) REFERENCES `abonne`(`id_abonne`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_formule`) REFERENCES `formule`(`id_formule`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id_site`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`apporteur_id`) REFERENCES `sous_distributeur`(`id_apporteur`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cree_par`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_abonnement_echeance` ON `abonnement` (`date_fin`,`statut`);--> statement-breakpoint
CREATE INDEX `idx_abonnement_abonne` ON `abonnement` (`id_abonne`);--> statement-breakpoint
CREATE TABLE `entreprise` (
	`id_entreprise` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nom` text NOT NULL,
	`devise` text DEFAULT 'XAF' NOT NULL,
	`logo_url` text,
	`date_creation` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `facture` (
	`id_facture` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`id_abonne` integer,
	`statut` text DEFAULT 'BROUILLON' NOT NULL,
	`montant_total` integer DEFAULT 0 NOT NULL,
	`cree_par` integer NOT NULL,
	`date_creation` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id_site`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_abonne`) REFERENCES `abonne`(`id_abonne`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cree_par`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `famille_abonnement` (
	`id_famille` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`libelle` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `famille_abonnement_libelle_unique` ON `famille_abonnement` (`libelle`);--> statement-breakpoint
CREATE TABLE `formule` (
	`id_formule` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_famille` integer NOT NULL,
	`libelle` text NOT NULL,
	`prix` integer NOT NULL,
	`rang` integer NOT NULL,
	`mode_duree` text DEFAULT 'STRICT_30J' NOT NULL,
	`duree_cycles` integer DEFAULT 1 NOT NULL,
	`actif` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`id_famille`) REFERENCES `famille_abonnement`(`id_famille`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `formule_option_compat` (
	`id_formule` integer NOT NULL,
	`id_option` integer NOT NULL,
	`prix_surcharge` integer,
	PRIMARY KEY(`id_formule`, `id_option`),
	FOREIGN KEY (`id_formule`) REFERENCES `formule`(`id_formule`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_option`) REFERENCES `option_complement`(`id_option`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `historique_abonnement` (
	`id_histo` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero_abonnement` integer NOT NULL,
	`type_changement` text NOT NULL,
	`valeur_avant` text,
	`valeur_apres` text,
	`motif` text,
	`utilisateur_id` integer NOT NULL,
	`date_changement` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`numero_abonnement`) REFERENCES `abonnement`(`numero_abonnement`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utilisateur_id`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `journal_audit` (
	`id_audit` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`utilisateur_id` integer NOT NULL,
	`action` text NOT NULL,
	`table_cible` text NOT NULL,
	`id_cible` text NOT NULL,
	`valeur_avant` text,
	`valeur_apres` text,
	`date_action` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`utilisateur_id`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_cible` ON `journal_audit` (`table_cible`,`id_cible`);--> statement-breakpoint
CREATE TABLE `kit` (
	`id_kit` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_famille` integer NOT NULL,
	`libelle` text NOT NULL,
	`regle_prix` text NOT NULL,
	`prix_fixe` integer,
	`prix_parabole_accessoires` integer DEFAULT 0 NOT NULL,
	`id_formule_reference` integer,
	`prix_kit_reference` integer,
	FOREIGN KEY (`id_famille`) REFERENCES `famille_abonnement`(`id_famille`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_formule_reference`) REFERENCES `formule`(`id_formule`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `kit_prix_decodeur` (
	`id_kit` integer NOT NULL,
	`id_formule` integer NOT NULL,
	`prix_decodeur` integer NOT NULL,
	PRIMARY KEY(`id_kit`, `id_formule`),
	FOREIGN KEY (`id_kit`) REFERENCES `kit`(`id_kit`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_formule`) REFERENCES `formule`(`id_formule`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ligne_vente` (
	`id_ligne` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_facture` integer NOT NULL,
	`id_produit` integer,
	`id_kit` integer,
	`numero_abonnement` integer,
	`quantite` integer DEFAULT 1 NOT NULL,
	`prix_applique` integer NOT NULL,
	FOREIGN KEY (`id_facture`) REFERENCES `facture`(`id_facture`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_produit`) REFERENCES `produit`(`id_produit`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_kit`) REFERENCES `kit`(`id_kit`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`numero_abonnement`) REFERENCES `abonnement`(`numero_abonnement`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `materiel_abonne` (
	`id_materiel` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero_abonnement` integer NOT NULL,
	`type_materiel` text NOT NULL,
	`numero_serie` text,
	`statut` text DEFAULT 'ACTIF' NOT NULL,
	`date_installation` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`numero_abonnement`) REFERENCES `abonnement`(`numero_abonnement`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `option_complement` (
	`id_option` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`libelle` text NOT NULL,
	`prix` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paiement` (
	`id_paiement` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_facture` integer NOT NULL,
	`mode` text NOT NULL,
	`montant` integer NOT NULL,
	`reference_transaction` text,
	`date_paiement` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`id_facture`) REFERENCES `facture`(`id_facture`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_paiement_reference` ON `paiement` (`reference_transaction`);--> statement-breakpoint
CREATE TABLE `produit` (
	`id_produit` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`type` text NOT NULL,
	`libelle` text NOT NULL,
	`prix_vente` integer NOT NULL,
	`cout_revient` integer DEFAULT 0 NOT NULL,
	`marge_type` text DEFAULT 'VALEUR' NOT NULL,
	`marge_valeur` integer,
	`marge_pourcentage` integer,
	`suivi_stock` integer DEFAULT 0 NOT NULL,
	`quantite_stock` integer DEFAULT 0 NOT NULL,
	`seuil_alerte` integer,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id_site`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sav_dossier` (
	`id_dossier_sav` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`id_abonne` integer,
	`description_panne` text NOT NULL,
	`etat_reception` text,
	`diagnostic` text,
	`statut` text DEFAULT 'RECU' NOT NULL,
	`sous_garantie` integer DEFAULT 0 NOT NULL,
	`date_reception` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id_site`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_abonne`) REFERENCES `abonne`(`id_abonne`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `site` (
	`id_site` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_entreprise` integer NOT NULL,
	`nom` text NOT NULL,
	`adresse` text,
	`actif` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`id_entreprise`) REFERENCES `entreprise`(`id_entreprise`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sous_distributeur` (
	`id_apporteur` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nom` text NOT NULL,
	`telephone` text,
	`taux_commission_defaut_pourmille` integer,
	`actif` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_mouvement` (
	`id_mouvement` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_produit` integer NOT NULL,
	`site_id` integer NOT NULL,
	`type_mouvement` text NOT NULL,
	`quantite` integer NOT NULL,
	`motif` text,
	`date_mouvement` text DEFAULT (datetime('now')) NOT NULL,
	`utilisateur_id` integer NOT NULL,
	FOREIGN KEY (`id_produit`) REFERENCES `produit`(`id_produit`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id_site`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utilisateur_id`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `suivi_commission_canalplus` (
	`id_suivi` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero_abonnement` integer NOT NULL,
	`vendeur_id` integer,
	`apporteur_id` integer,
	`montant_commission` integer NOT NULL,
	`date_fin_probatoire` text NOT NULL,
	`statut` text DEFAULT 'EN_COURS' NOT NULL,
	FOREIGN KEY (`numero_abonnement`) REFERENCES `abonnement`(`numero_abonnement`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendeur_id`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`apporteur_id`) REFERENCES `sous_distributeur`(`id_apporteur`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `utilisateur` (
	`id_user` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`nom` text NOT NULL,
	`prenom` text NOT NULL,
	`identifiant` text NOT NULL,
	`mot_de_passe_hash` text NOT NULL,
	`role` text NOT NULL,
	`actif` integer DEFAULT 1 NOT NULL,
	`date_creation` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id_site`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_utilisateur_identifiant` ON `utilisateur` (`identifiant`);