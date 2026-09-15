ALTER TABLE `facture` ADD `jeton_verification` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `facture` SET `jeton_verification` = lower(hex(randomblob(16))) WHERE `jeton_verification` = '';