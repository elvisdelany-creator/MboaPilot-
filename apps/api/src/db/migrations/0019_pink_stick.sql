CREATE TABLE `sav_photo` (
	`id_photo` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_dossier_sav` integer NOT NULL,
	`nom_fichier` text NOT NULL,
	`nom_fichier_original` text NOT NULL,
	`type_mime` text NOT NULL,
	`date_ajout` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`id_dossier_sav`) REFERENCES `sav_dossier`(`id_dossier_sav`) ON UPDATE no action ON DELETE no action
);
