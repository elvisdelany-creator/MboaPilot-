CREATE TABLE `commission_canalplus_en_attente` (
	`id_facture` integer PRIMARY KEY NOT NULL,
	`numero_abonnement` integer NOT NULL,
	`vendeur_id` integer NOT NULL,
	`apporteur_id` integer,
	`montant_commission` integer NOT NULL,
	`date_fin_probatoire` text NOT NULL,
	FOREIGN KEY (`id_facture`) REFERENCES `facture`(`id_facture`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`numero_abonnement`) REFERENCES `abonnement`(`numero_abonnement`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendeur_id`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`apporteur_id`) REFERENCES `sous_distributeur`(`id_apporteur`) ON UPDATE no action ON DELETE no action
);
