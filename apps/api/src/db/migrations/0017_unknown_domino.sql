CREATE TABLE `licence` (
	`id_licence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`palier` text DEFAULT 'ESSENTIEL' NOT NULL,
	`empreinte_installation` text NOT NULL,
	`date_expiration_abonnement` text NOT NULL,
	`derniere_revalidation_reussie` text NOT NULL
);
