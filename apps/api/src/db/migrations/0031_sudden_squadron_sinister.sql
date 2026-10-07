CREATE INDEX `idx_abonnement_site_statut_fin` ON `abonnement` (`site_id`,`statut`,`date_fin`);--> statement-breakpoint
CREATE INDEX `idx_facture_site_statut_date` ON `facture` (`site_id`,`statut`,`date_creation`);--> statement-breakpoint
CREATE INDEX `idx_ligne_vente_facture` ON `ligne_vente` (`id_facture`);--> statement-breakpoint
CREATE INDEX `idx_paiement_facture` ON `paiement` (`id_facture`);--> statement-breakpoint
CREATE INDEX `idx_paiement_date` ON `paiement` (`date_paiement`);