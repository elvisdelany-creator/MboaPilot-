ALTER TABLE `utilisateur` ADD `tentatives_echouees` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `utilisateur` ADD `verrouille_jusqua` text;