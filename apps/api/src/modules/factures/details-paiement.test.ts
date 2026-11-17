import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { jourDouala } from "@mboapilot/shared";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";
import { creerPaiement } from "./paiement.repository.js";
import * as schema from "../../db/schema.js";

// Les détails d'un chèque ou d'un virement (banque, numéro, titulaire, date, référence) étaient exigés par les seuls écrans de caisse : appelé
// directement, le serveur enregistrait un chèque sans numéro, un virement sans référence, une date « pas une date » ou un texte de 5 000
// caractères. Constaté en test grandeur nature. Le serveur fait maintenant respecter la règle, pour tous les modes d'encaissement.
const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";
const AUJOURDHUI = jourDouala();
const CHEQUE = { banque: "Afriland First Bank", numeroCheque: "0012345", titulaireCheque: "Paul Nga", dateCheque: AUJOURDHUI };
const VIREMENT = { banque: "Orange Money", referenceVirement: "OM123456" };

let db: Db;
let app: FastifyInstance;
let siteId: number;
let userId: number;
let gerantId: number;
let idProduit: number;
let idFormule: number;
let idFactureTest: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Paul", identifiant: "caissier1", motDePasse: "motdepasse-secret", role: "CAISSIER" }).idUser;
  gerantId = creerUtilisateur(db, { siteId, nom: "Mbia", prenom: "Luc", identifiant: "gerant1", motDePasse: "motdepasse-secret", role: "GERANT" }).idUser;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "Netflix" }).returning().get();
  idFormule = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "1 mois", prix: 3500, rang: 1 }).returning().get().idFormule;
  idProduit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, coutRevient: 1000, suiviStock: 1, quantiteStock: 10 }).returning().get().idProduit;
  const abonne = db.insert(schema.abonne).values({ siteId, nom: "Client", prenom: "Test", telephone: "690000000" }).returning().get();
  idFactureTest = db.insert(schema.facture).values({ siteId, idAbonne: abonne.idAbonne, creePar: userId, montantTotal: 10000 }).returning().get().idFacture;
  app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
});

const entetes = async (identifiant = "caissier1") => {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse: "motdepasse-secret" } });
  return { authorization: `Bearer ${reponse.json().token as string}` };
};

const vente = (details: Record<string, unknown>, montant = 2500) => ({
  siteId,
  userId,
  lignes: [{ idProduit, quantite: 1 }],
  montantEncaisse: montant,
  totalAttendu: montant,
  ...details,
});

const stock = () => db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduit)).get()!.quantiteStock;
const nombreFactures = () => db.select().from(schema.facture).all().length;
const nombrePaiements = () => db.select().from(schema.paiement).all().length;

describe("creerPaiement : détails d'un chèque ou d'un virement", () => {
  it("refuse un chèque sans numéro, un virement sans référence, et dit ce qui manque", () => {
    expect(() => creerPaiement(db, { idFacture: idFactureTest, mode: "CHEQUE", montant: 1000, utilisateurId: userId, ...CHEQUE, numeroCheque: undefined })).toThrow(/numéro/i);
    expect(() => creerPaiement(db, { idFacture: idFactureTest, mode: "VIREMENT", montant: 1000, utilisateurId: userId, ...VIREMENT, referenceVirement: undefined })).toThrow(/référence/i);
    expect(nombrePaiements()).toBe(0);
  });

  it("accepte un chèque complet, un virement complet, du comptant, et enregistre les textes sans espaces superflus", () => {
    const cheque = creerPaiement(db, { idFacture: idFactureTest, mode: "CHEQUE", montant: 1000, utilisateurId: userId, ...CHEQUE, banque: "  Afriland First Bank  ", numeroCheque: " 0012345 " });
    expect(cheque).toMatchObject({ banque: "Afriland First Bank", numeroCheque: "0012345" });
    expect(creerPaiement(db, { idFacture: idFactureTest, mode: "VIREMENT", montant: 1000, utilisateurId: userId, ...VIREMENT, referenceVirement: " OM123456 " }).referenceVirement).toBe("OM123456");
    expect(creerPaiement(db, { idFacture: idFactureTest, mode: "CASH", montant: 1000, utilisateurId: userId }).mode).toBe("CASH");
  });

  it("un remboursement (montant négatif) par chèque ou virement n'a pas de détails à fournir : l'argent sort, il ne rentre pas", () => {
    expect(creerPaiement(db, { idFacture: idFactureTest, mode: "CHEQUE", montant: -1000, utilisateurId: userId }).montant).toBe(-1000);
    expect(creerPaiement(db, { idFacture: idFactureTest, mode: "VIREMENT", montant: -1000, utilisateurId: userId }).montant).toBe(-1000);
  });
});

describe("POST /api/v1/ventes : le serveur refuse un encaissement incomplet", () => {
  it.each([
    ["un chèque sans numéro", { modePaiement: "CHEQUE", ...CHEQUE, numeroCheque: undefined }, /numéro/i],
    ["un chèque sans banque", { modePaiement: "CHEQUE", ...CHEQUE, banque: "" }, /banque/i],
    ["un chèque sans titulaire", { modePaiement: "CHEQUE", ...CHEQUE, titulaireCheque: undefined }, /titulaire/i],
    ["un chèque dont la date n'est pas une date", { modePaiement: "CHEQUE", ...CHEQUE, dateCheque: "pas une date" }, /date/i],
    ["un chèque postdaté de cinq ans", { modePaiement: "CHEQUE", ...CHEQUE, dateCheque: `${Number(AUJOURDHUI.slice(0, 4)) + 5}-01-01` }, /date/i],
    ["un chèque dont la banque fait 5 000 caractères", { modePaiement: "CHEQUE", ...CHEQUE, banque: "B".repeat(5000) }, /banque/i],
    ["un virement sans banque", { modePaiement: "VIREMENT", ...VIREMENT, banque: undefined }, /banque/i],
    ["un virement sans référence", { modePaiement: "VIREMENT", ...VIREMENT, referenceVirement: undefined }, /référence/i],
  ])("refuse %s (400) et ne laisse rien derrière : ni facture, ni paiement, ni sortie de stock", async (_nom, details, message) => {
    const reponse = await app.inject({ method: "POST", url: "/api/v1/ventes", headers: await entetes(), payload: vente(details) });

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().erreur).toMatch(message);
    expect(nombreFactures()).toBe(1); // celle de la mise en place du test
    expect(nombrePaiements()).toBe(0);
    expect(stock()).toBe(10);
  });

  it("accepte un chèque complet et un virement complet", async () => {
    const cheque = await app.inject({ method: "POST", url: "/api/v1/ventes", headers: await entetes(), payload: vente({ modePaiement: "CHEQUE", ...CHEQUE }) });
    const virement = await app.inject({ method: "POST", url: "/api/v1/ventes", headers: await entetes(), payload: vente({ modePaiement: "VIREMENT", ...VIREMENT }) });

    expect(cheque.statusCode).toBe(201);
    expect(virement.statusCode).toBe(201);
    expect(stock()).toBe(8);
  });

  it("une vente au comptant n'a aucun détail à fournir", async () => {
    const reponse = await app.inject({ method: "POST", url: "/api/v1/ventes", headers: await entetes(), payload: vente({ modePaiement: "CASH" }) });
    expect(reponse.statusCode).toBe(201);
  });
});

describe("les autres chemins d'encaissement appliquent la même règle", () => {
  it("POST /api/v1/recrutements : un virement sans référence est refusé et aucun abonnement n'est créé", async () => {
    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: await entetes(),
      payload: { siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Nouveau", prenom: "Client", telephone: "690000111" }, idFormule, montantEncaisse: 3500, totalAttendu: 3500, modePaiement: "VIREMENT", banque: "Orange Money" },
    });

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().erreur).toMatch(/référence/i);
    expect(db.select().from(schema.abonnement).all()).toHaveLength(0);
    expect(db.select().from(schema.abonne).all()).toHaveLength(1); // le client n'est pas créé non plus
  });

  it("POST /api/v1/factures/:id/paiements : un chèque sans numéro est refusé, le solde reste dû", async () => {
    const reponse = await app.inject({
      method: "POST",
      url: `/api/v1/factures/${idFactureTest}/paiements`,
      headers: await entetes(),
      payload: { userId, montant: 4000, modePaiement: "CHEQUE", ...CHEQUE, numeroCheque: undefined },
    });

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().erreur).toMatch(/numéro/i);
    expect(nombrePaiements()).toBe(0);
  });

  it("un avoir remboursé par chèque reste possible sans détails (l'argent sort)", async () => {
    const venteCash = await app.inject({ method: "POST", url: "/api/v1/ventes", headers: await entetes(), payload: vente({ modePaiement: "CASH" }, 2500) });
    const idFacture = venteCash.json().idFacture as number;
    const idLigne = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, idFacture)).get()!.idLigne;

    const avoir = await app.inject({
      method: "POST",
      url: `/api/v1/factures/${idFacture}/avoir`,
      headers: await entetes("gerant1"),
      payload: { lignes: [{ idLigneOrigine: idLigne, quantite: 1 }], restituerStock: true, userId: gerantId, remboursement: { mode: "CHEQUE" } },
    });

    expect(avoir.statusCode).toBe(201);
    expect(avoir.json().montantRembourse).toBe(2500);
  });
});
