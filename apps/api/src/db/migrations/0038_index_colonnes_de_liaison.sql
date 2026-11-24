CREATE INDEX `idx_facture_abonne` ON `facture` (`id_abonne`);--> statement-breakpoint
CREATE INDEX `idx_facture_date` ON `facture` (`date_creation`,`id_facture`);--> statement-breakpoint
CREATE INDEX `idx_facture_origine` ON `facture` (`facture_origine_id`);--> statement-breakpoint
CREATE INDEX `idx_historique_abonnement_abonnement` ON `historique_abonnement` (`numero_abonnement`);--> statement-breakpoint
CREATE INDEX `idx_historique_abonnement_date` ON `historique_abonnement` (`date_changement`,`id_histo`);--> statement-breakpoint
CREATE INDEX `idx_historique_prix_date` ON `historique_prix_produit` (`date_changement`,`id_histo_prix`);--> statement-breakpoint
CREATE INDEX `idx_audit_date` ON `journal_audit` (`date_action`,`id_audit`);--> statement-breakpoint
CREATE INDEX `idx_audit_table_date` ON `journal_audit` (`table_cible`,`date_action`,`id_audit`);--> statement-breakpoint
CREATE INDEX `idx_ligne_vente_abonnement` ON `ligne_vente` (`numero_abonnement`);--> statement-breakpoint
CREATE INDEX `idx_materiel_abonne_abonnement` ON `materiel_abonne` (`numero_abonnement`);--> statement-breakpoint
CREATE INDEX `idx_notification_abonne` ON `notification` (`id_abonne`);--> statement-breakpoint
CREATE INDEX `idx_sav_dossier_facture` ON `sav_dossier` (`id_facture`);--> statement-breakpoint
CREATE INDEX `idx_sav_dossier_abonne` ON `sav_dossier` (`id_abonne`);--> statement-breakpoint
CREATE INDEX `idx_sav_historique_date` ON `sav_historique` (`date_changement`,`id_histo_sav`);--> statement-breakpoint
CREATE INDEX `idx_stock_mouvement_produit_type_date` ON `stock_mouvement` (`id_produit`,`type_mouvement`,`date_mouvement`);--> statement-breakpoint
CREATE INDEX `idx_stock_mouvement_date` ON `stock_mouvement` (`date_mouvement`,`id_mouvement`);--> statement-breakpoint
CREATE INDEX `idx_suivi_commission_abonnement` ON `suivi_commission_canalplus` (`numero_abonnement`);--> statement-breakpoint
CREATE INDEX `idx_transaction_mobile_money_facture` ON `transaction_mobile_money` (`id_facture`);