import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { creerAvoir } from "./avoir.service.js";
import { soldeFacture } from "@mboapilot/shared";
import { fermerCaisse, obtenirComptagesCloture, ouvrirCaisse } from "../caisse/cloture-caisse.service.js";

let db: Db;
let siteId: number;
let userId: number;
let idAbonne: number;
let idProduitSuivi: number;
let idProduitSansStock: number;
let idFactureValidee: number;
let idLigneProduitSuivi: number;
let idLigneSansStock: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" })
    .returning()
    .get().idUser;
  idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Alice", telephone: "690000000" }).returning().get().idAbonne;

  idProduitSuivi = db
    .insert(schema.produit)
    .values({ siteId, type: "BIEN", libelle: "Télécommande", prixVente: 2500, suiviStock: 1, quantiteStock: 5 })
    .returning()
    .get().idProduit;
  idProduitSansStock = db
    .insert(schema.produit)
    .values({ siteId, type: "SERVICE", libelle: "Installation", prixVente: 5000, suiviStock: 0 })
    .returning()
    .get().idProduit;

  const facture = db
    .insert(schema.facture)
    .values({ siteId, idAbonne, statut: "VALIDEE", montantTotal: 3 * 2500 + 5000, creePar: userId })
    .returning()
    .get();
  idFactureValidee = facture.idFacture;

  idLigneProduitSuivi = db
    .insert(schema.ligneVente)
    .values({ idFacture: idFactureValidee, idProduit: idProduitSuivi, quantite: 3, prixApplique: 3 * 2500 })
    .returning()
    .get().idLigne;
  idLigneSansStock = db
    .insert(schema.ligneVente)
    .values({ idFacture: idFactureValidee, idProduit: idProduitSansStock, quantite: 1, prixApplique: 5000 })
    .returning()
    .get().idLigne;
});

describe("creerAvoir (6.4)", () => {
  it("crée une facture AVOIR au montant négatif, rattachée à la facture d'origine", () => {
    const resultat = creerAvoir(db, {
      idFactureOrigine: idFactureValidee,
      lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 3 }],
      restituerStock: false,
      userId,
    });

    expect(resultat.montantTotal).toBe(-7500);
    const factureAvoir = db.select().from(schema.facture).where(eq(schema.facture.idFacture, resultat.idFactureAvoir)).get();
    expect(factureAvoir).toMatchObject({ type: "AVOIR", factureOrigineId: idFactureValidee, statut: "VALIDEE", montantTotal: -7500 });

    const lignes = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, resultat.idFactureAvoir)).all();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ ligneOrigineId: idLigneProduitSuivi, quantite: 3, prixApplique: -7500 });
  });

  it("accepte un avoir partiel (quantité inférieure à celle facturée)", () => {
    const resultat = creerAvoir(db, {
      idFactureOrigine: idFactureValidee,
      lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }],
      restituerStock: false,
      userId,
    });

    expect(resultat.montantTotal).toBe(-2500);
  });

  it("empêche de créditer plus que ce qui reste facturé, cumulé sur plusieurs avoirs", () => {
    creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 2 }], restituerStock: false, userId });

    expect(() =>
      creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 2 }], restituerStock: false, userId })
    ).toThrow(/disponible|quantité/i);

    // le reliquat exact (1) reste créditable
    const resultat = creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }], restituerStock: false, userId });
    expect(resultat.montantTotal).toBe(-2500);
  });

  it("restitue le stock uniquement si demandé, et uniquement pour un produit suivi", () => {
    creerAvoir(db, {
      idFactureOrigine: idFactureValidee,
      lignes: [
        { idLigneOrigine: idLigneProduitSuivi, quantite: 2 },
        { idLigneOrigine: idLigneSansStock, quantite: 1 },
      ],
      restituerStock: true,
      userId,
    });

    const produitSuivi = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduitSuivi)).get();
    expect(produitSuivi?.quantiteStock).toBe(7); // 5 + 2 restitués

    const mouvements = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idProduitSuivi)).all();
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0].typeMouvement).toBe("RETOUR_CLIENT");
    expect(mouvements[0].quantite).toBe(2);
  });

  it("ne restitue rien au stock quand restituerStock est faux", () => {
    creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 2 }], restituerStock: false, userId });

    const produitSuivi = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduitSuivi)).get();
    expect(produitSuivi?.quantiteStock).toBe(5);
  });

  it("rejette un avoir sur une facture BROUILLON", () => {
    const brouillon = db.insert(schema.facture).values({ siteId, idAbonne, statut: "BROUILLON", montantTotal: 1000, creePar: userId }).returning().get();
    const ligne = db.insert(schema.ligneVente).values({ idFacture: brouillon.idFacture, idProduit: idProduitSuivi, quantite: 1, prixApplique: 1000 }).returning().get();

    expect(() => creerAvoir(db, { idFactureOrigine: brouillon.idFacture, lignes: [{ idLigneOrigine: ligne.idLigne, quantite: 1 }], restituerStock: false, userId })).toThrow(
      /VALIDEE/
    );
  });

  it("rejette un avoir émis sur un avoir", () => {
    const premier = creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }], restituerStock: false, userId });
    const ligneAvoir = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, premier.idFactureAvoir)).all()[0];

    expect(() =>
      creerAvoir(db, { idFactureOrigine: premier.idFactureAvoir, lignes: [{ idLigneOrigine: ligneAvoir.idLigne, quantite: 1 }], restituerStock: false, userId })
    ).toThrow(/avoir/i);
  });

  it("rejette une ligne n'appartenant pas à la facture d'origine indiquée", () => {
    const autreFacture = db.insert(schema.facture).values({ siteId, idAbonne, statut: "VALIDEE", montantTotal: 1000, creePar: userId }).returning().get();

    expect(() =>
      creerAvoir(db, { idFactureOrigine: autreFacture.idFacture, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }], restituerStock: false, userId })
    ).toThrow(/introuvable/i);
  });

  it("rejette une facture inconnue", () => {
    expect(() => creerAvoir(db, { idFactureOrigine: 999999, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }], restituerStock: false, userId })).toThrow(
      /introuvable/i
    );
  });

  it("rejette un avoir sans ligne", () => {
    expect(() => creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [], restituerStock: false, userId })).toThrow(/ligne/i);
  });

  it("rejette une quantité à créditer nulle ou négative", () => {
    expect(() =>
      creerAvoir(db, { idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 0 }], restituerStock: false, userId })
    ).toThrow(/quantité/i);
  });

  // 3.2.3, 6.1, 8.8 : "porte le total, la TVA/taxes le cas échéant" — le
  // montant de taxe crédité est négatif, comme le montant total de l'avoir
  it("persiste un montant de taxe négatif, proportionnel au montant crédité", () => {
    db.update(schema.entreprise).set({ tauxTva: 2000 }).run(); // 20 %

    const resultat = creerAvoir(db, {
      idFactureOrigine: idFactureValidee,
      lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 3 }],
      restituerStock: false,
      userId,
    });

    const factureAvoir = db.select().from(schema.facture).where(eq(schema.facture.idFacture, resultat.idFactureAvoir)).get();
    expect(factureAvoir?.montantTaxe).toBe(-1250); // -7500 TTC -> HT -6250, taxe -1250
  });
});

// Décision du 2026-10-19 : le remboursement d'un avoir s'enregistre avec l'avoir. Sans cela l'argent rendu au client
// n'existait nulle part : la facture créditée restait « surpayée » et la clôture de caisse accusait un manque
// d'espèces à tort. Un remboursement est un paiement NÉGATIF sur la facture d'origine : il solde la facture et se
// déduit du théorique de clôture, par mode de paiement.
describe("creerAvoir : remboursement enregistré avec l'avoir", () => {
  const payerFacture = () =>
    db.insert(schema.paiement).values({ idFacture: idFactureValidee, mode: "CASH", montant: 3 * 2500 + 5000, utilisateurId: userId }).run();
  const params = (extra: object = {}) => ({ idFactureOrigine: idFactureValidee, lignes: [{ idLigneOrigine: idLigneProduitSuivi, quantite: 1 }], restituerStock: false, userId, ...extra });
  const paiementsOrigine = () => db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, idFactureValidee)).all();
  const soldeOrigine = () => {
    const factures = db.select().from(schema.facture).all();
    return soldeFacture(factures.find((f) => f.idFacture === idFactureValidee)!, factures, db.select().from(schema.paiement).all());
  };

  it("rembourse l'avoir en espèces : paiement négatif sur la facture d'origine, qui est alors soldée", () => {
    payerFacture();

    const resultat = creerAvoir(db, params({ remboursement: { mode: "CASH" } }));

    expect(resultat).toMatchObject({ montantTotal: -2500, montantRembourse: 2500 });
    expect(paiementsOrigine().filter((p) => p.montant < 0)).toEqual([expect.objectContaining({ mode: "CASH", montant: -2500, utilisateurId: userId })]);
    expect(soldeOrigine()).toBe(0);
  });

  it("accepte un remboursement partiel", () => {
    payerFacture();

    const resultat = creerAvoir(db, params({ remboursement: { mode: "MOBILE_MONEY", montant: 1000 } }));

    expect(resultat.montantRembourse).toBe(1000);
    expect(paiementsOrigine().find((p) => p.montant < 0)).toMatchObject({ mode: "MOBILE_MONEY", montant: -1000 });
  });

  it("sans remboursement, n'écrit aucun paiement (la facture reste à rembourser)", () => {
    payerFacture();

    const resultat = creerAvoir(db, params());

    expect(resultat.montantRembourse).toBe(0);
    expect(paiementsOrigine()).toHaveLength(1);
    expect(soldeOrigine()).toBe(-2500);
  });

  it("refuse un remboursement sur une facture non payée, sans créer l'avoir", () => {
    expect(() => creerAvoir(db, params({ remboursement: { mode: "CASH" } }))).toThrow(/rembours/i);

    expect(db.select().from(schema.facture).where(eq(schema.facture.type, "AVOIR")).all()).toHaveLength(0);
  });

  it("refuse un remboursement supérieur à ce qui a été payé en trop, sans créer l'avoir", () => {
    payerFacture();

    expect(() => creerAvoir(db, params({ remboursement: { mode: "CASH", montant: 3000 } }))).toThrow(/rembours/i);

    expect(db.select().from(schema.facture).where(eq(schema.facture.type, "AVOIR")).all()).toHaveLength(0);
    expect(paiementsOrigine()).toHaveLength(1);
  });

  it("refuse un mode de paiement inconnu ou un montant invalide", () => {
    payerFacture();
    expect(() => creerAvoir(db, params({ remboursement: { mode: "TROC" } }))).toThrow(/mode/i);
    expect(() => creerAvoir(db, params({ remboursement: { mode: "CASH", montant: 0 } }))).toThrow(/montant/i);
    expect(() => creerAvoir(db, params({ remboursement: { mode: "CASH", montant: 12.5 } }))).toThrow(/montant/i);
    expect(db.select().from(schema.facture).where(eq(schema.facture.type, "AVOIR")).all()).toHaveLength(0);
  });

  it("déduit un remboursement en espèces du théorique CASH de la clôture de caisse", () => {
    const cloture = ouvrirCaisse(db, { siteId, userId, fondOuverture: 10000 });
    payerFacture(); // +12 500 en espèces pendant la session

    creerAvoir(db, params({ remboursement: { mode: "CASH" } })); // −2 500 rendus au client

    fermerCaisse(db, { idCloture: cloture.idCloture, userId, comptages: [{ mode: "CASH", montantCompte: 20000 }] });
    const cash = obtenirComptagesCloture(db, cloture.idCloture).find((c) => c.mode === "CASH")!;
    expect(cash.montantTheorique).toBe(10000 + 12500 - 2500);
    expect(cash.ecart).toBe(0);
  });
});


// Constaté en test grandeur nature : la vente d'un kit retire chacun de ses composants du stock (décodeur, parabole…), mais
// l'avoir d'une ligne de kit avec « remettre en stock » ne rendait rien : le matériel revenu au magasin restait absent du stock.
describe("creerAvoir : restitution du stock d'un kit (6.4, 5.1, 5.2)", () => {
  let idKit: number;
  let idDecodeur: number;
  let idCable: number;
  let idAccessoireSansStock: number;
  let idFactureKit: number;
  let idLigneKit: number;

  const stock = (idProduit: number) => db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduit)).get()?.quantiteStock;

  beforeEach(() => {
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
    idKit = db.insert(schema.kit).values({ idFamille: famille, libelle: "Kit G11", reglePrix: "PRIX_FIXE", prixFixe: 40000 }).returning().get().idKit;
    // stock après la vente de 2 kits : 5 décodeurs - 2, 10 câbles - 4
    idDecodeur = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Décodeur G11", prixVente: 20000, suiviStock: 1, quantiteStock: 3 }).returning().get().idProduit;
    idCable = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 1000, suiviStock: 1, quantiteStock: 6 }).returning().get().idProduit;
    idAccessoireSansStock = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Vis et chevilles", prixVente: 0, suiviStock: 0 }).returning().get().idProduit;
    db.insert(schema.kitComposant).values([
      { idKit, idProduit: idDecodeur, quantite: 1 },
      { idKit, idProduit: idCable, quantite: 2 },
      { idKit, idProduit: idAccessoireSansStock, quantite: 1 },
    ]).run();
    idFactureKit = db.insert(schema.facture).values({ siteId, idAbonne, statut: "VALIDEE", montantTotal: 80000, creePar: userId }).returning().get().idFacture;
    idLigneKit = db.insert(schema.ligneVente).values({ idFacture: idFactureKit, idKit, quantite: 2, prixApplique: 80000 }).returning().get().idLigne;
  });

  it("remet en stock chaque composant suivi, multiplié par la quantité de kits créditée", () => {
    creerAvoir(db, { idFactureOrigine: idFactureKit, lignes: [{ idLigneOrigine: idLigneKit, quantite: 1 }], restituerStock: true, userId });

    expect(stock(idDecodeur)).toBe(4); // 3 + 1 décodeur
    expect(stock(idCable)).toBe(8); // 6 + 2 câbles
    const mouvements = db.select().from(schema.stockMouvement).all();
    expect(mouvements.map((m) => [m.idProduit, m.typeMouvement, m.quantite]).sort()).toEqual(
      [[idDecodeur, "RETOUR_CLIENT", 1], [idCable, "RETOUR_CLIENT", 2]].sort(),
    );
  });

  it("n'y touche pas quand restituerStock est faux", () => {
    creerAvoir(db, { idFactureOrigine: idFactureKit, lignes: [{ idLigneOrigine: idLigneKit, quantite: 2 }], restituerStock: false, userId });

    expect(stock(idDecodeur)).toBe(3);
    expect(stock(idCable)).toBe(6);
  });

  it("rend la totalité des composants quand les deux kits sont crédités", () => {
    creerAvoir(db, { idFactureOrigine: idFactureKit, lignes: [{ idLigneOrigine: idLigneKit, quantite: 2 }], restituerStock: true, userId });

    expect(stock(idDecodeur)).toBe(5);
    expect(stock(idCable)).toBe(10);
  });
});
