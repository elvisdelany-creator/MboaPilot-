import { eq, sql } from "drizzle-orm";
import { decalerJour, jourDouala } from "@mboapilot/shared";
import type { Db } from "../db/types.js";
import * as schema from "../db/schema.js";
import { creerUtilisateur } from "../modules/utilisateurs/utilisateur.repository.js";
import { chargerCatalogueDepart, listerOperateursDepart } from "../modules/catalogue/catalogue-depart.js";
import { creerProduit } from "../modules/produits/produit.repository.js";
import { receptionnerAchat } from "../modules/stock/stock.service.js";
import { creerApporteur } from "../modules/apporteurs/apporteur.repository.js";
import { recruterAbonne } from "../modules/abonnements/recrutement.service.js";
import { reprendreAbonneExistant } from "../modules/abonnements/reprise.service.js";
import { creerVenteProduits } from "../modules/ventes/vente.service.js";
import { creerDossierSav } from "../modules/sav/sav.repository.js";
import { affecterPieceSav, changerStatutSav } from "../modules/sav/sav.service.js";
import { fermerCaisse, ouvrirCaisse } from "../modules/caisse/cloture-caisse.service.js";
import { executerJobQuotidien } from "../modules/jobs/job-quotidien.service.js";
import { COMPTES_DEMO } from "./mode-demo.js";

export interface ResultatPeuplementDemo {
  siteId: number;
}

// Boutique fictive pour la démo publique : de quoi montrer des écrans vivants (échéances à relancer, abonnements expirés, stock bas, SAV à
// plusieurs stades, historique de ventes, apporteurs, caisse ouverte) sans une seule donnée réelle. Tout passe par les services de
// l'application (jamais d'insertion brute des montants) : les factures, le stock et les commissions restent cohérents entre eux.
// Les dates sont relatives à aujourd'hui, pour que la démo reste crédible quel que soit le jour où elle démarre.
const CLIENTS: { nom: string; prenom: string }[] = [
  { nom: "Nga Ndongo", prenom: "Valentin" },
  { nom: "Mbarga", prenom: "Jean" },
  { nom: "Tchouaké", prenom: "Aimé" },
  { nom: "Fotso", prenom: "Carine" },
  { nom: "Essomba", prenom: "Paul" },
  { nom: "Ngo Bayiha", prenom: "Sylvie" },
  { nom: "Kamga", prenom: "Élodie" },
  { nom: "Onana", prenom: "Patrick" },
  { nom: "Nkoulou", prenom: "Brice" },
  { nom: "Manga", prenom: "Josiane" },
  { nom: "Biyong", prenom: "Hervé" },
  { nom: "Abena", prenom: "Clarisse" },
  { nom: "Tamo", prenom: "Rodrigue" },
  { nom: "Ewane", prenom: "Mireille" },
  { nom: "Atangana", prenom: "Serge" },
  { nom: "Njoh", prenom: "Pascaline" },
];

// numéros fictifs : le préfixe 600 n'est attribué à aucun opérateur, aucun visiteur de la démo ne risque d'appeler un vrai client
const telephone = (n: number) => `6000000${String(n).padStart(2, "0")}`;

const heureDuJour = (jour: string) => `${jour} 10:00:00`;

export function peuplerDemo(db: Db): ResultatPeuplementDemo {
  const aujourdHui = jourDouala();

  const entreprise = db.insert(schema.entreprise).values({ nom: "Boutique Démo MboaPilot" }).returning().get();
  const site = db.insert(schema.site).values({ idEntreprise: entreprise.idEntreprise, nom: "Douala — Akwa", adresse: "Boulevard de la Liberté, Akwa (boutique fictive)" }).returning().get();
  const siteId = site.idSite;

  const [compteGerant, compteCaissier, compteTechnicien] = COMPTES_DEMO.map((c) => {
    const [prenom, ...reste] = c.libelle.split(" ");
    return creerUtilisateur(db, { siteId, nom: reste.join(" ") || "Démo", prenom: prenom === "Technicien" ? "Sam" : prenom === "Caissier" ? "Paul" : "Marie", identifiant: c.identifiant, motDePasse: c.motDePasse, role: c.role });
  });
  const gerant = compteGerant.idUser;
  const caissier = compteCaissier.idUser;
  const technicien = compteTechnicien.idUser;

  // licence : une démo ne doit jamais passer en lecture seule ; le palier Pro montre aussi l'export comptable
  db.insert(schema.licence)
    .values({
      palier: "PRO",
      empreinteInstallation: `demo-${entreprise.idEntreprise}`,
      dateExpirationAbonnement: decalerJour(aujourdHui, 3650),
      derniereRevalidationReussie: new Date().toISOString(),
    })
    .run();

  // catalogue d'abonnements : tous les opérateurs du catalogue de départ (CANAL+, DStv, StarTimes, 24H Sport, Moreplex, streaming)
  chargerCatalogueDepart(db, listerOperateursDepart().map((o) => o.cle), gerant);
  const formulesSatellite = db
    .select({ idFormule: schema.formule.idFormule, libelle: schema.formule.libelle, prix: schema.formule.prix, famille: schema.familleAbonnement.libelle })
    .from(schema.formule)
    .innerJoin(schema.familleAbonnement, eq(schema.formule.idFamille, schema.familleAbonnement.idFamille))
    .all()
    .filter((f) => /canal|dstv|startimes/i.test(f.famille) && f.prix > 0);

  // articles et services, avec leur stock (achats réels, donc coût moyen pondéré cohérent) ; le décodeur de remplacement est volontairement
  // sous son seuil d'alerte pour montrer l'alerte de rupture
  const article = (libelle: string, categorie: string, prixVente: number, coutRevient: number, stock: number, seuil: number) => {
    const p = creerProduit(db, { siteId, type: "BIEN", libelle, categorie, prixVente, coutRevient, margeType: "VALEUR", margeValeur: prixVente - coutRevient, suiviStock: true, seuilAlerte: seuil });
    receptionnerAchat(db, { idProduit: p.idProduit, siteId, quantite: stock, coutUnitaire: coutRevient, userId: gerant });
    return p;
  };
  const cable = article("Câble HDMI 2 m", "Câbles", 2500, 1000, 80, 10);
  const telecommande = article("Télécommande universelle", "Accessoires", 3000, 1200, 40, 8);
  const decodeur = article("Décodeur de remplacement", "Décodeurs", 25000, 15000, 4, 5);
  const parabole = article("Parabole 60 cm + support", "Antennes", 18000, 11000, 25, 4);
  const prise = article("Prise coaxiale", "Câbles", 500, 150, 150, 20);
  const antenne = article("Antenne TNT intérieure", "Antennes", 6500, 3800, 30, 4);
  const prestation = (libelle: string, prixVente: number) => creerProduit(db, { siteId, type: "SERVICE", libelle, categorie: "Services", prixVente, margeType: "VALEUR", margeValeur: prixVente });
  prestation("Installation à domicile", 5000);
  prestation("Configuration décodeur", 2000);

  // apporteurs d'affaires
  const apporteurs = [
    creerApporteur(db, { nom: "Jean-Claude Mbarga", telephone: telephone(90), tauxCommissionDefaut: 100 }),
    creerApporteur(db, { nom: "Sandrine Tchoua", telephone: telephone(91), tauxCommissionDefaut: 150 }),
  ];

  // clients : quatre recrutements du jour (encaissés), le reste repris avec des échéances étalées autour d'aujourd'hui — de quoi remplir
  // la liste « Abonnements à échéance » (J-1, J-3, J-7) et « Abonnements expirés »
  const echeances = [0, 1, 2, 3, 5, 6, 7, 12, 20, -2, -9, -25];
  const clientsCrees: number[] = [];
  CLIENTS.forEach((c, i) => {
    const formule = formulesSatellite[i % formulesSatellite.length];
    if (i < 4) {
      recruterAbonne(db, {
        siteId, userId: caissier, aujourdHui,
        abonne: { nom: c.nom, prenom: c.prenom, telephone: telephone(i + 1) },
        idFormule: formule.idFormule, montantEncaisse: formule.prix, apporteurId: apporteurs[i % 2].idApporteur,
      });
    } else {
      reprendreAbonneExistant(db, {
        siteId, userId: gerant, aujourdHui,
        abonne: { nom: c.nom, prenom: c.prenom, telephone: telephone(i + 1) },
        idFormule: formule.idFormule, dateFin: decalerJour(aujourdHui, echeances[(i - 4) % echeances.length]),
      });
    }
    clientsCrees.push(i + 1);
  });
  const idsAbonnes = db.select().from(schema.abonne).all();
  const idAbonne = (n: number) => idsAbonnes.find((a) => a.telephone === telephone(n))!.idAbonne;

  // historique de ventes de produits sur deux semaines (antidatées à 10 h UTC du jour voulu, donc dans la bonne journée de Douala) :
  // alimente la courbe d'évolution du chiffre d'affaires et les marges
  const catalogue = [cable, telecommande, prise, antenne, parabole];
  const aVenter = (n: number) => catalogue[n % catalogue.length];
  for (let joursAvant = 13; joursAvant >= 0; joursAvant--) {
    const ventesDuJour = joursAvant % 3 === 0 ? 3 : 2;
    for (let v = 0; v < ventesDuJour; v++) {
      const p = aVenter(joursAvant + v);
      const quantite = 1 + ((joursAvant + v) % 3);
      const total = p.prixVente * quantite;
      const vente = creerVenteProduits(db, { siteId, userId: caissier, lignes: [{ idProduit: p.idProduit, quantite }], montantEncaisse: total });
      if (joursAvant > 0) {
        const quand = heureDuJour(decalerJour(aujourdHui, -joursAvant));
        db.update(schema.facture).set({ dateCreation: quand }).where(eq(schema.facture.idFacture, vente.idFacture)).run();
        db.update(schema.paiement).set({ datePaiement: quand }).where(eq(schema.paiement.idFacture, vente.idFacture)).run();
      }
    }
  }
  // une créance : acompte d'un client, solde à encaisser (onglet « Impayées » de la fiche client)
  creerVenteProduits(db, { siteId, userId: caissier, lignes: [{ idProduit: parabole.idProduit, quantite: 1 }], montantEncaisse: 8000, idAbonne: idAbonne(6) });

  // dossiers SAV à plusieurs stades
  const ouvrirSav = (descriptionPanne: string, etatReception: string, sousGarantie: boolean, qui: { idAbonne: number } | { clientNom: string; clientTelephone: string }) =>
    creerDossierSav(db, { siteId, userId: technicien, descriptionPanne, etatReception, sousGarantie, ...qui });
  ouvrirSav("Le décodeur ne s'allume plus", "Boîtier rayé, télécommande absente", false, { idAbonne: idAbonne(1) });
  const enDiagnostic = ouvrirSav("Image qui saute sur toutes les chaînes", "Bon état", true, { idAbonne: idAbonne(2) });
  changerStatutSav(db, { idDossierSav: enDiagnostic.idDossierSav, nouveauStatut: "DIAGNOSTIC", userId: technicien, diagnostic: "Tête LNB à tester" });
  const enReparation = ouvrirSav("Télécommande qui ne répond plus", "Boîtier propre", false, { clientNom: "Client de passage", clientTelephone: telephone(92) });
  changerStatutSav(db, { idDossierSav: enReparation.idDossierSav, nouveauStatut: "DIAGNOSTIC", userId: technicien, diagnostic: "Télécommande à remplacer" });
  changerStatutSav(db, { idDossierSav: enReparation.idDossierSav, nouveauStatut: "REPARATION", userId: technicien });
  affecterPieceSav(db, { idDossierSav: enReparation.idDossierSav, idProduit: telecommande.idProduit, quantite: 1, userId: technicien });
  const pret = ouvrirSav("Parabole mal orientée après la pluie", "Bon état", false, { idAbonne: idAbonne(3) });
  changerStatutSav(db, { idDossierSav: pret.idDossierSav, nouveauStatut: "DIAGNOSTIC", userId: technicien, diagnostic: "Réorientation et fixation à refaire" });
  changerStatutSav(db, { idDossierSav: pret.idDossierSav, nouveauStatut: "REPARATION", userId: technicien });
  changerStatutSav(db, { idDossierSav: pret.idDossierSav, nouveauStatut: "PRET", userId: technicien, montantMainOeuvre: 5000 });

  // l'historique des ventes est « clôturé » (écart nul), puis la caisse du jour est ouverte : à la fermeture, le caissier ne voit que les
  // encaissements d'aujourd'hui, pas deux semaines de ventes d'un coup
  const sessionPassee = ouvrirCaisse(db, { siteId, userId: caissier, fondOuverture: 20000 });
  const encaisse = db.all<{ mode: "CASH" | "CHEQUE" | "VIREMENT" | "MOBILE_MONEY"; total: number }>(sql`select mode, sum(montant) total from paiement group by mode`);
  fermerCaisse(db, {
    idCloture: sessionPassee.idCloture,
    userId: gerant,
    comptages: encaisse.map((e) => ({ mode: e.mode, montantCompte: e.total + (e.mode === "CASH" ? 20000 : 0) })),
  });
  ouvrirCaisse(db, { siteId, userId: caissier, fondOuverture: 25000 });

  // alertes d'échéance et expirations du jour, comme le job quotidien le ferait à l'ouverture de la boutique
  executerJobQuotidien(db, aujourdHui);

  return { siteId };
}
