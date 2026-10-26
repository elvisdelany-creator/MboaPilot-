CREATE TABLE `operation_abonnement_en_attente` (
	`id_facture` integer PRIMARY KEY NOT NULL,
	`numero_abonnement` integer NOT NULL,
	`type` text NOT NULL,
	`details` text NOT NULL,
	FOREIGN KEY (`id_facture`) REFERENCES `facture`(`id_facture`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`numero_abonnement`) REFERENCES `abonnement`(`numero_abonnement`) ON UPDATE no action ON DELETE no action
);
