PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notification` (
	`id_notification` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_abonne` integer,
	`canal` text NOT NULL,
	`evenement` text NOT NULL,
	`destinataire` text NOT NULL,
	`message` text NOT NULL,
	`statut_envoi` text NOT NULL,
	`id_alerte` integer,
	`id_dossier_sav` integer,
	`date_envoi` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`id_abonne`) REFERENCES `abonne`(`id_abonne`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_alerte`) REFERENCES `alerte_echeance`(`id_alerte`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_dossier_sav`) REFERENCES `sav_dossier`(`id_dossier_sav`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_notification`("id_notification", "id_abonne", "canal", "evenement", "destinataire", "message", "statut_envoi", "id_alerte", "id_dossier_sav", "date_envoi") SELECT "id_notification", "id_abonne", "canal", "evenement", "destinataire", "message", "statut_envoi", "id_alerte", "id_dossier_sav", "date_envoi" FROM `notification`;--> statement-breakpoint
DROP TABLE `notification`;--> statement-breakpoint
ALTER TABLE `__new_notification` RENAME TO `notification`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `sav_dossier` ADD `client_nom` text;--> statement-breakpoint
ALTER TABLE `sav_dossier` ADD `client_telephone` text;