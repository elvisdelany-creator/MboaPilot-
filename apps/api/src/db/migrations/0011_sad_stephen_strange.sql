CREATE TABLE `kit_composant` (
	`id_kit` integer NOT NULL,
	`id_produit` integer NOT NULL,
	`quantite` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`id_kit`, `id_produit`),
	FOREIGN KEY (`id_kit`) REFERENCES `kit`(`id_kit`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`id_produit`) REFERENCES `produit`(`id_produit`) ON UPDATE no action ON DELETE no action
);
