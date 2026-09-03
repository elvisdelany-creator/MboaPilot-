PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_alerte_echeance` (
	`id_alerte` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero_abonnement` integer NOT NULL,
	`jalon` integer NOT NULL,
	`date_declenchement` text NOT NULL,
	`date_creation` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`numero_abonnement`) REFERENCES `abonnement`(`numero_abonnement`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_alerte_echeance`("id_alerte", "numero_abonnement", "jalon", "date_declenchement", "date_creation") SELECT "id_alerte", "numero_abonnement", "jalon", "date_declenchement", "date_creation" FROM `alerte_echeance`;--> statement-breakpoint
DROP TABLE `alerte_echeance`;--> statement-breakpoint
ALTER TABLE `__new_alerte_echeance` RENAME TO `alerte_echeance`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_alerte_unique` ON `alerte_echeance` (`numero_abonnement`,`jalon`,`date_declenchement`);--> statement-breakpoint
ALTER TABLE `entreprise` ADD `jalon_alerte_urgent_jours` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `entreprise` ADD `jalon_alerte_modere_jours` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `entreprise` ADD `jalon_alerte_anticipe_jours` integer DEFAULT 7 NOT NULL;