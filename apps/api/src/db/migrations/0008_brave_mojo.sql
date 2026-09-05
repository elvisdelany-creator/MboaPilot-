CREATE TABLE `notification` (
	`id_notification` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_abonne` integer NOT NULL,
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
