PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_paiement` (
	`id_paiement` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_facture` integer NOT NULL,
	`mode` text NOT NULL,
	`montant` integer NOT NULL,
	`utilisateur_id` integer NOT NULL,
	`reference_transaction` text,
	`banque` text,
	`numero_cheque` text,
	`titulaire_cheque` text,
	`date_cheque` text,
	`reference_virement` text,
	`date_paiement` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`id_facture`) REFERENCES `facture`(`id_facture`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utilisateur_id`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_paiement`("id_paiement", "id_facture", "mode", "montant", "utilisateur_id", "reference_transaction", "banque", "numero_cheque", "titulaire_cheque", "date_cheque", "reference_virement", "date_paiement")
SELECT "id_paiement", "id_facture", "mode", "montant", (SELECT f.cree_par FROM facture f WHERE f.id_facture = paiement.id_facture), "reference_transaction", "banque", "numero_cheque", "titulaire_cheque", "date_cheque", "reference_virement", "date_paiement" FROM `paiement`;
--> statement-breakpoint
DROP TABLE `paiement`;--> statement-breakpoint
ALTER TABLE `__new_paiement` RENAME TO `paiement`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_paiement_reference` ON `paiement` (`reference_transaction`);
