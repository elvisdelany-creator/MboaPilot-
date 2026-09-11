CREATE TABLE `cloture_caisse` (
	`id_cloture` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` integer NOT NULL,
	`fond_ouverture` integer NOT NULL,
	`ouvert_par` integer NOT NULL,
	`date_ouverture` text DEFAULT (datetime('now')) NOT NULL,
	`statut` text DEFAULT 'OUVERTE' NOT NULL,
	`ferme_par` integer,
	`date_fermeture` text,
	`ecart_total` integer,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id_site`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ouvert_par`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ferme_par`) REFERENCES `utilisateur`(`id_user`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cloture_caisse_comptage` (
	`id_comptage` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id_cloture` integer NOT NULL,
	`mode` text NOT NULL,
	`montant_theorique` integer NOT NULL,
	`montant_compte` integer NOT NULL,
	`ecart` integer NOT NULL,
	FOREIGN KEY (`id_cloture`) REFERENCES `cloture_caisse`(`id_cloture`) ON UPDATE no action ON DELETE no action
);
