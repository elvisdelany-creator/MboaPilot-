ALTER TABLE `entreprise` ADD `politique_mdp_longueur_min` integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE `entreprise` ADD `politique_mdp_exiger_majuscule` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `entreprise` ADD `politique_mdp_exiger_chiffre` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `entreprise` ADD `politique_mdp_exiger_caractere_special` integer DEFAULT 0 NOT NULL;