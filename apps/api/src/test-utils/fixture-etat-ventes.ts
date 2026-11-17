import * as schema from "../db/schema.js";
import type { Db } from "./db.js";

export interface FixtureEtatVentes {
  siteId: number;
  autreSiteId: number;
  userId: number;
  idAbonne: number;
  factures: { f1: number; f2: number; f3: number; avoir: number; f4: number; f5: number };
}

// Jeu de données des tests d'états : voir la table du plan (docs/superpowers/plans/2026-11-17-etat-des-ventes.md, tâche 4). Les dates sont en UTC,
// comme dans la base : F2 est créée à 23 h 30 UTC, donc le 04/11 à Douala.
export function creerFixtureEtatVentes(db: Db): FixtureEtatVentes {
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const siteId = db
    .insert(schema.site)
    .values({ idEntreprise: ent.idEntreprise, nom: "Douala — Akwa", adresse: "Boulevard de la Liberté", telephone: "677 00 00 00" })
    .returning()
    .get().idSite;
  const autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  const userId = db.insert(schema.utilisateur).values({ siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  const idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555" }).returning().get().idAbonne;

  const canal = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  const netflix = db.insert(schema.familleAbonnement).values({ libelle: "Netflix" }).returning().get().idFamille;
  const evasion = db.insert(schema.formule).values({ idFamille: canal, libelle: "EVASION", prix: 10500, rang: 3 }).returning().get().idFormule;
  const unMois = db.insert(schema.formule).values({ idFamille: netflix, libelle: "1 mois", prix: 3500, rang: 1 }).returning().get().idFormule;
  const abonnementCanal = db.insert(schema.abonnement).values({ idAbonne, idFormule: evasion, siteId, dateDebut: "2026-11-01", dateFin: "2026-11-30", creePar: userId }).returning().get().numeroAbonnement;
  const abonnementNetflix = db.insert(schema.abonnement).values({ idAbonne, idFormule: unMois, siteId, dateDebut: "2026-11-04", dateFin: "2026-12-03", creePar: userId }).returning().get().numeroAbonnement;
  const cable = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500 }).returning().get().idProduit;
  const mainOeuvre = db.insert(schema.produit).values({ siteId, type: "SAV", libelle: "Main d'œuvre SAV", prixVente: 3000 }).returning().get().idProduit;

  const facture = (valeurs: Partial<typeof schema.facture.$inferInsert> & { montantTotal: number; dateCreation: string }) =>
    db
      .insert(schema.facture)
      .values({ siteId, idAbonne, creePar: userId, statut: "VALIDEE", montantTaxe: 0, ...valeurs })
      .returning()
      .get().idFacture;
  const ligne = (idFacture: number, valeurs: Partial<typeof schema.ligneVente.$inferInsert> & { prixApplique: number }) =>
    db.insert(schema.ligneVente).values({ idFacture, ...valeurs }).run();
  const paiement = (idFacture: number, mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY", montant: number, datePaiement: string) =>
    db.insert(schema.paiement).values({ idFacture, mode, montant, utilisateurId: userId, datePaiement }).run();

  const f1 = facture({ montantTotal: 11900, montantTaxe: 1900, dateCreation: "2026-11-03 09:00:00" });
  ligne(f1, { numeroAbonnement: abonnementCanal, prixApplique: 10500 });
  ligne(f1, { idProduit: cable, quantite: 1, prixApplique: 1400 });
  paiement(f1, "CASH", 11900, "2026-11-03 09:05:00");

  const f2 = facture({ montantTotal: 3500, dateCreation: "2026-11-03 23:30:00" });
  ligne(f2, { numeroAbonnement: abonnementNetflix, prixApplique: 3500 });
  paiement(f2, "VIREMENT", 2000, "2026-11-03 23:35:00");
  paiement(f2, "CASH", 1500, "2026-12-01 10:00:00");

  const f3 = facture({ montantTotal: 5000, dateCreation: "2026-11-05 10:00:00" });
  ligne(f3, { idProduit: cable, quantite: 2, prixApplique: 5000 });
  paiement(f3, "CHEQUE", 5000, "2026-11-05 10:01:00");

  const avoir = facture({ type: "AVOIR", factureOrigineId: f3, montantTotal: -2500, dateCreation: "2026-11-06 11:00:00" });
  ligne(avoir, { idProduit: cable, quantite: 1, prixApplique: -2500 });
  paiement(f3, "CASH", -2500, "2026-11-06 11:01:00"); // le remboursement est rattaché à la facture d'origine, comme dans l'application

  const f4 = facture({ idAbonne: null, montantTotal: 3000, dateCreation: "2026-11-07 08:00:00" });
  ligne(f4, { idProduit: mainOeuvre, quantite: 1, prixApplique: 3000 });
  paiement(f4, "MOBILE_MONEY", 3000, "2026-11-07 08:05:00");

  const f5 = facture({ montantTotal: 4000, dateCreation: "2026-11-09 10:00:00" });
  ligne(f5, { idProduit: cable, quantite: 4, prixApplique: 4000 });
  paiement(f5, "CASH", 1000, "2026-11-09 10:05:00");

  // hors périmètre : brouillon, autre boutique, autre mois
  facture({ statut: "BROUILLON", montantTotal: 9999, dateCreation: "2026-11-08 10:00:00" });
  const autreSite = facture({ siteId: autreSiteId, idAbonne: null, montantTotal: 7777, dateCreation: "2026-11-08 12:00:00" });
  paiement(autreSite, "CASH", 7777, "2026-11-08 12:05:00");
  facture({ montantTotal: 1234, dateCreation: "2026-12-02 10:00:00" });

  return { siteId, autreSiteId, userId, idAbonne, factures: { f1, f2, f3, avoir, f4, f5 } };
}
