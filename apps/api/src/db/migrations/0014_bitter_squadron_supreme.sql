CREATE TABLE `reglement_commission` (
	`id_reglement` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`apporteur_id` integer NOT NULL,
	`montant` integer NOT NULL,
	`mode_paiement` text NOT NULL,
	`reference` text,
	`utilisateur_id` integer NOT NULL,
	`date_reglement` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`apporteur_id`) REFERENCES `sous_distributeur`(`id_apporteur`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utilisateur_id`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action
);
