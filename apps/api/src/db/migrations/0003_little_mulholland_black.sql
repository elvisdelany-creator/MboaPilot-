CREATE TABLE `compte_partage_streaming` (
	`id_compte_partage` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`id_famille` integer NOT NULL,
	`libelle` text NOT NULL,
	`identifiant` text,
	`mot_de_passe` text,
	`nombre_ecrans_max` integer NOT NULL,
	`actif` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id_site`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_famille`) REFERENCES `famille_abonnement`(`id_famille`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `abonnement` ADD `id_compte_partage` integer REFERENCES compte_partage_streaming(id_compte_partage);--> statement-breakpoint
CREATE INDEX `idx_abonnement_compte_partage` ON `abonnement` (`id_compte_partage`);