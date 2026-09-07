ALTER TABLE `facture` ADD `type` text DEFAULT 'VENTE' NOT NULL;--> statement-breakpoint
ALTER TABLE `facture` ADD `facture_origine_id` integer REFERENCES facture(id_facture);--> statement-breakpoint
ALTER TABLE `ligne_vente` ADD `ligne_origine_id` integer REFERENCES ligne_vente(id_ligne);