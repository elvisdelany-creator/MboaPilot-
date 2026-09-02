CREATE TABLE `historique_prix_produit` (
	`id_histo_prix` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_produit` integer NOT NULL,
	`prix_vente_avant` integer NOT NULL,
	`prix_vente_apres` integer NOT NULL,
	`cout_revient_avant` integer NOT NULL,
	`cout_revient_apres` integer NOT NULL,
	`utilisateur_id` integer NOT NULL,
	`date_changement` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`id_produit`) REFERENCES `produit`(`id_produit`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utilisateur_id`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `produit` ADD `categorie` text;