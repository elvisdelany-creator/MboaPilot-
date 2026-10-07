import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "./test-utils/db.js";
import * as schema from "./db/schema.js";
import { creerVenteProduits } from "./modules/ventes/vente.service.js";
import { recruterAbonne } from "./modules/abonnements/recrutement.service.js";
import { reabonner } from "./modules/abonnements/reabonnement.service.js";
import { changerFormule } from "./modules/abonnements/changement-formule.service.js";
import { echangerMateriel } from "./modules/abonnements/echange-materiel.service.js";
import { encaisserSoldeFacture } from "./modules/factures/paiement-complementaire.service.js";
import { creerAvoir } from "./modules/factures/avoir.service.js";
import { creerProduit, modifierProduit } from "./modules/produits/produit.repository.js";
import { creerAbonne } from "./modules/abonnes/abonne.repository.js";

// Constaté par fuzz de types sur l'API en test grandeur nature : les gardes
// `montant <= 0` / `remise < 0` sont fausses pour « abc » ou NaN, et laissent
// passer les décimaux (1.5) et les valeurs géantes (1e30) — stockés tels quels
// dans les colonnes entières de factures, lignes et paiements, ou, après une
// écriture partielle (vente sans transaction), laissés à moitié enregistrés.
let db: Db;
let siteId: number;
let userId: number;
let compaq: number;
let premium: number;
let idProduit: number;
let numeroAbonnement: number;
let idFacture: number;
let idLigne: number;

const MONTANTS_INVALIDES: unknown[] = ["abc", 1.5, Number.NaN, 1e30, -1, null];

function compter() {
  return {
    factures: db.select().from(schema.facture).all().length,
    lignes: db.select().from(schema.ligneVente).all().length,
    paiements: db.select().from(schema.paiement).all().length,
    mouvements: db.select().from(schema.stockMouvement).all().length,
    abonnes: db.select().from(schema.abonne).all().length,
    abonnements: db.select().from(schema.abonnement).all().length,
    produit: db.select().from(schema.produit).all().map((p) => [p.idProduit, p.quantiteStock, p.prixVente]),
  };
}

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get().idFamille;
  compaq = db.insert(schema.formule).values({ idFamille: famille, libelle: "COMPAQ", prix: 13000, rang: 3 }).returning().get().idFormule;
  premium = db.insert(schema.formule).values({ idFamille: famille, libelle: "PREMIUM", prix: 28000, rang: 5 }).returning().get().idFormule;
  idProduit = db
    .insert(schema.produit)
    .values({ siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000, suiviStock: 1, quantiteStock: 10 })
    .returning()
    .get().idProduit;

  numeroAbonnement = recruterAbonne(db, {
    siteId,
    userId,
    aujourdHui: "2026-10-01",
    abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
    idFormule: compaq,
    montantEncaisse: 13000,
  }).numeroAbonnement;

  // facture de vente partiellement payée (solde dû), pour l'encaissement complémentaire et l'avoir
  const vente = creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit, quantite: 2 }], montantEncaisse: 1000 });
  idFacture = vente.idFacture;
  idLigne = db.select().from(schema.ligneVente).all().find((l) => l.idFacture === idFacture)!.idLigne;
});

describe("vente de produits : entrées invalides (5.2, 6.4)", () => {
  it.each(MONTANTS_INVALIDES)("refuse un montant encaissé %s sans rien enregistrer", (montantEncaisse) => {
    const avant = compter();
    expect(() => creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit, quantite: 1 }], montantEncaisse: montantEncaisse as never })).toThrow(/montant encaissé/i);
    expect(compter()).toEqual(avant);
  });

  it.each(["abc", 1.5, Number.NaN, 1e30, 0, -1, null])("refuse une quantité de ligne %s sans rien enregistrer", (quantite) => {
    const avant = compter();
    expect(() => creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit, quantite: quantite as never }], montantEncaisse: 0 })).toThrow(/quantité/i);
    expect(compter()).toEqual(avant);
  });

  it.each(["abc", 1.5, Number.NaN, 1e30, -1, null])("refuse une remise de ligne %s sans rien enregistrer", (remise) => {
    const avant = compter();
    expect(() => creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit, quantite: 1, remise: remise as never }], montantEncaisse: 0 })).toThrow(/remise/i);
    expect(compter()).toEqual(avant);
  });

  it.each(["BITCOIN", { x: 1 }, 5])("refuse le mode de paiement %s", (mode) => {
    const avant = compter();
    expect(() => creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit, quantite: 1 }], montantEncaisse: 1000, modePaiement: mode as never })).toThrow(/mode de paiement/i);
    expect(compter()).toEqual(avant);
  });

  it.each([null, undefined, "x", { x: 1 }])("refuse des lignes qui ne sont pas un tableau : %s", (lignes) => {
    expect(() => creerVenteProduits(db, { siteId, userId, lignes: lignes as never, montantEncaisse: 0 })).toThrow(/article/i);
  });

  it("une erreur au milieu de la vente n'en laisse aucune trace (atomicité)", () => {
    const avant = compter();
    expect(() =>
      creerVenteProduits(db, { siteId, userId, lignes: [{ idProduit, quantite: 1 }, { idProduit: 999999, quantite: 1 }], montantEncaisse: 0 })
    ).toThrow(/introuvable/i);
    expect(compter()).toEqual(avant);
  });

  it("refuse le paiement d'un client ponctuel mal formé sans rien enregistrer", () => {
    const avant = compter();
    expect(() =>
      creerVenteProduits(db, { siteId, userId, nouvelAbonne: { nom: 123 as never, prenom: "X", telephone: "690111111" }, lignes: [{ idProduit, quantite: 1 }], montantEncaisse: 0 })
    ).toThrow(/nom/i);
    expect(compter()).toEqual(avant);
  });
});

describe("recrutement, réabonnement, changement de formule, échange : montants invalides (7.1-7.4)", () => {
  it.each(MONTANTS_INVALIDES)("recruterAbonne refuse un montant encaissé %s", (montantEncaisse) => {
    const avant = compter();
    expect(() =>
      recruterAbonne(db, { siteId, userId, aujourdHui: "2026-10-01", abonne: { nom: "Neuf", prenom: "Client", telephone: "690222222" }, idFormule: compaq, montantEncaisse: montantEncaisse as never })
    ).toThrow(/montant encaissé/i);
    expect(compter()).toEqual(avant);
  });

  it.each(["abc", 1.5, Number.NaN, 1e30, -1, null])("recruterAbonne refuse une remise %s", (remise) => {
    const avant = compter();
    expect(() =>
      recruterAbonne(db, { siteId, userId, aujourdHui: "2026-10-01", abonne: { nom: "Neuf", prenom: "Client", telephone: "690222222" }, idFormule: compaq, montantEncaisse: 0, remise: remise as never })
    ).toThrow(/remise/i);
    expect(compter()).toEqual(avant);
  });

  it.each(["BITCOIN", { x: 1 }])("recruterAbonne refuse le mode de paiement %s", (mode) => {
    const avant = compter();
    expect(() =>
      recruterAbonne(db, { siteId, userId, aujourdHui: "2026-10-01", abonne: { nom: "Neuf", prenom: "Client", telephone: "690222222" }, idFormule: compaq, montantEncaisse: 1000, modePaiement: mode as never })
    ).toThrow(/mode de paiement/i);
    expect(compter()).toEqual(avant);
  });

  it.each(MONTANTS_INVALIDES)("reabonner refuse un montant encaissé %s", (montantEncaisse) => {
    const avant = compter();
    expect(() => reabonner(db, { siteId, userId, aujourdHui: "2026-10-05", numeroAbonnement, montantEncaisse: montantEncaisse as never })).toThrow(/montant encaissé/i);
    expect(compter()).toEqual(avant);
  });

  it.each(["abc", 1.5, Number.NaN, 1e30, -1, null])("reabonner refuse une remise %s", (remise) => {
    const avant = compter();
    expect(() => reabonner(db, { siteId, userId, aujourdHui: "2026-10-05", numeroAbonnement, montantEncaisse: 0, remise: remise as never })).toThrow(/remise/i);
    expect(compter()).toEqual(avant);
  });

  it.each(MONTANTS_INVALIDES)("changerFormule refuse un montant encaissé %s", (montantEncaisse) => {
    const avant = compter();
    expect(() =>
      changerFormule(db, { siteId, userId, aujourdHui: "2026-10-05", numeroAbonnement, idNouvelleFormule: premium, montantEncaisse: montantEncaisse as never })
    ).toThrow(/montant encaissé/i);
    expect(compter()).toEqual(avant);
  });

  it.each(MONTANTS_INVALIDES)("echangerMateriel refuse un montant encaissé %s", (montantEncaisse) => {
    const avant = compter();
    expect(() =>
      echangerMateriel(db, { siteId, userId, numeroAbonnement, idProduit, typeMateriel: "DECODEUR", sousGarantie: false, motif: "panne", montantEncaisse: montantEncaisse as never })
    ).toThrow(/montant encaissé/i);
    expect(compter()).toEqual(avant);
  });

  it.each([123, { x: 1 }])("echangerMateriel refuse un motif ou un type de matériel qui n'est pas un texte : %s", (valeur) => {
    const avant = compter();
    expect(() =>
      echangerMateriel(db, { siteId, userId, numeroAbonnement, idProduit, typeMateriel: valeur as never, sousGarantie: false, motif: "panne", montantEncaisse: 0 })
    ).toThrow(/matériel/i);
    expect(() =>
      echangerMateriel(db, { siteId, userId, numeroAbonnement, idProduit, typeMateriel: "DECODEUR", sousGarantie: false, motif: valeur as never, montantEncaisse: 0 })
    ).toThrow(/motif/i);
    expect(compter()).toEqual(avant);
  });
});

describe("encaissement complémentaire et avoir : montants invalides (6.4, 6.5)", () => {
  it.each(["abc", 1.5, Number.NaN, 1e30, 0, -1, null])("encaisserSoldeFacture refuse le montant %s", (montant) => {
    const avant = compter();
    expect(() => encaisserSoldeFacture(db, { idFacture, userId, montant: montant as never })).toThrow(/montant encaissé/i);
    expect(compter()).toEqual(avant);
  });

  it.each(["abc", 1.5, Number.NaN, 1e30, 0, -1, null])("creerAvoir refuse la quantité à créditer %s", (quantite) => {
    const avant = compter();
    expect(() => creerAvoir(db, { idFactureOrigine: idFacture, userId, restituerStock: true, lignes: [{ idLigneOrigine: idLigne, quantite: quantite as never }] })).toThrow(/quantité/i);
    expect(compter()).toEqual(avant);
  });
});

describe("produits : prix et seuils invalides (8.2)", () => {
  it.each(["abc", 1.5, Number.NaN, 1e30, null])("creerProduit refuse un prix de vente %s", (prixVente) => {
    const avant = compter();
    expect(() => creerProduit(db, { siteId, type: "BIEN", libelle: "Neuf", prixVente: prixVente as never })).toThrow(/prix de vente/i);
    expect(compter()).toEqual(avant);
  });

  it.each(["abc", 1.5, Number.NaN, 1e30])("creerProduit refuse un coût de revient %s", (coutRevient) => {
    expect(() => creerProduit(db, { siteId, type: "BIEN", libelle: "Neuf", prixVente: 1000, coutRevient: coutRevient as never })).toThrow(/coût de revient/i);
  });

  it.each(["abc", 1.5, Number.NaN, 1e30, -1])("creerProduit refuse un seuil d'alerte %s", (seuilAlerte) => {
    expect(() => creerProduit(db, { siteId, type: "BIEN", libelle: "Neuf", prixVente: 1000, seuilAlerte: seuilAlerte as never })).toThrow(/seuil/i);
  });

  it.each([["prixVente", "abc"], ["prixVente", 1.5], ["coutRevient", "abc"], ["coutRevient", 1e30], ["seuilAlerte", 1.5]])("modifierProduit refuse %s = %s sans modifier l'article", (champ, valeur) => {
    const avant = compter();
    expect(() => modifierProduit(db, idProduit, { [champ]: valeur, userId } as never)).toThrow(/prix|coût|seuil/i);
    expect(compter()).toEqual(avant);
  });
});

describe("abonné : identité mal typée (8.1)", () => {
  it.each([123, { x: 1 }, null])("creerAbonne refuse un nom, prénom ou téléphone qui n'est pas un texte : %s", (valeur) => {
    expect(() => creerAbonne(db, { siteId, nom: valeur as never, prenom: "X", telephone: "690333333" })).toThrow(/nom/i);
    expect(() => creerAbonne(db, { siteId, nom: "X", prenom: valeur as never, telephone: "690333333" })).toThrow(/prénom/i);
    expect(() => creerAbonne(db, { siteId, nom: "X", prenom: "Y", telephone: valeur as never })).toThrow(/téléphone/i);
  });
});
