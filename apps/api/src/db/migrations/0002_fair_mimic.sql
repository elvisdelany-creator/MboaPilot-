CREATE TABLE `transaction_mobile_money` (
	`id_transaction` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_facture` integer NOT NULL,
	`parcours` text NOT NULL,
	`numero_telephone` text NOT NULL,
	`montant` integer NOT NULL,
	`statut` text DEFAULT 'INITIEE' NOT NULL,
	`reference_transaction` text,
	`date_creation` text DEFAULT (datetime('now')) NOT NULL,
	`date_expiration` text NOT NULL,
	FOREIGN KEY (`id_facture`) REFERENCES `facture`(`id_facture`) ON UPDATE no action ON DELETE no action
);
