PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_journal_audit` (
	`id_audit` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`utilisateur_id` integer,
	`action` text NOT NULL,
	`table_cible` text NOT NULL,
	`id_cible` text NOT NULL,
	`valeur_avant` text,
	`valeur_apres` text,
	`date_action` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`utilisateur_id`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_journal_audit`("id_audit", "utilisateur_id", "action", "table_cible", "id_cible", "valeur_avant", "valeur_apres", "date_action") SELECT "id_audit", "utilisateur_id", "action", "table_cible", "id_cible", "valeur_avant", "valeur_apres", "date_action" FROM `journal_audit`;--> statement-breakpoint
DROP TABLE `journal_audit`;--> statement-breakpoint
ALTER TABLE `__new_journal_audit` RENAME TO `journal_audit`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_audit_cible` ON `journal_audit` (`table_cible`,`id_cible`);--> statement-breakpoint
ALTER TABLE `entreprise` ADD `duree_conservation_donnees_jours` integer DEFAULT 1095 NOT NULL;