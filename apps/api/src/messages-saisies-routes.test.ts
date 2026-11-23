import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "./test-utils/db.js";
import * as schema from "./db/schema.js";
import { buildApp } from "./app.js";
import { creerUtilisateur } from "./modules/utilisateurs/utilisateur.repository.js";
import { creerApporteur } from "./modules/apporteurs/apporteur.repository.js";
import { recruterAbonne } from "./modules/abonnements/recrutement.service.js";
import { creerProduit } from "./modules/produits/produit.repository.js";

// Constaté au test de saisies hostiles : sur sept routes, un corps incomplet ou mal typé n'était pas contrôlé par le code mais arrêté par la base
// (champ obligatoire, liaison SQL) et traduit en un message générique — « Des champs obligatoires sont manquants ou invalides » —
// qui ne dit pas quel champ corriger. Chaque route doit maintenant nommer le champ en cause.
const GENERIQUES = /Requête mal formée|champs obligatoires sont manquants|Un élément référencé|règles de validation/;

let db: Db;
let app: ReturnType<typeof buildApp>;
let token: string;
let siteId: number;
let idAdmin: number;
let idCaissier: number;
let idFamille: number;
let idApporteur: number;
let idProduit: number;
let idAutreSite: number;

beforeAll(async () => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  idAutreSite = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  idAdmin = creerUtilisateur(db, { siteId, nom: "Ad", prenom: "Min", identifiant: "admin", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" }).idUser;
  idCaissier = creerUtilisateur(db, { siteId, nom: "Ca", prenom: "Isse", identifiant: "caisse", motDePasse: "motdepasse-secret", role: "CAISSIER" }).idUser;
  const canal = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  idFamille = canal.idFamille;
  const idFormule = db.insert(schema.formule).values({ idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
  const idKit = db.insert(schema.kit).values({ idFamille, libelle: "KIT CANAL+", reglePrix: "PRIX_FIXE", prixFixe: 20500 }).returning().get().idKit;
  // un apporteur avec 10 000 FCFA de commission confirmée : de quoi enregistrer un règlement
  const apporteur = creerApporteur(db, { nom: "Jean Apporteur", tauxCommissionDefaut: 500 });
  idApporteur = apporteur.idApporteur;
  const recrutement = recruterAbonne(db, {
    siteId, userId: idCaissier, aujourdHui: "2025-11-16", abonne: { nom: "Nga", prenom: "V", telephone: "690000000" }, idFormule, idKit, montantEncaisse: 20500, apporteurId: idApporteur,
  });
  db.update(schema.suiviCommissionCanalplus).set({ statut: "CONFIRMEE", montantCommission: 10000 }).where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, recrutement.numeroAbonnement)).run();
  idProduit = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble", prixVente: 1000, suiviStock: true }).idProduit;
  app = buildApp(db, { jwtSecret: "secret-de-test" });
  token = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "admin", motDePasse: "motdepasse-secret" } })).json().token;
});

async function appeler(methode: "POST" | "PATCH", url: string, corps: unknown) {
  const reponse = await app.inject({
    method: methode,
    url,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { statut: reponse.statusCode, erreur: (reponse.json() as { erreur?: string }).erreur ?? "", corps: reponse.json() };
}

// la réponse est un refus 4xx qui nomme le champ en cause, jamais le message générique de la base
async function refus(methode: "POST" | "PATCH", url: string, corps: unknown, attendu: RegExp) {
  const { statut, erreur } = await appeler(methode, url, corps);
  expect(statut, erreur).toBe(400);
  expect(erreur).toMatch(attendu);
  expect(erreur).not.toMatch(GENERIQUES);
}

describe("corps de requête qui n'est pas un objet", () => {
  it.each([
    ["liaison option-formule", "POST", "/api/v1/catalogue/options/compat"],
    ["création de kit", "POST", "/api/v1/catalogue/kits"],
    ["transfert de stock", "POST", "/api/v1/stock/transferts"],
    ["création d'utilisateur", "POST", "/api/v1/utilisateurs"],
    ["réinitialisation de mot de passe", "POST", "/api/v1/utilisateurs/2/mot-de-passe"],
    ["import CSV", "POST", "/api/v1/produits/import-csv"],
    ["règlement d'apporteur", "POST", "/api/v1/apporteurs/1/reglements"],
  ] as const)("%s : tableau, texte, nombre ou booléen sont refusés en le disant", async (_nom, methode, url) => {
    // (un corps « null » est ramené à {} par l'authentification : il tombe dans les contrôles de champs manquants, testés plus bas)
    for (const corps of [[], "texte", 123, true]) await refus(methode, url, corps, /corps de la requête/i);
  });
});

describe("POST /api/v1/catalogue/options/compat : lier une option à une formule", () => {
  it("nomme le champ manquant ou mal typé", async () => {
    await refus("POST", "/api/v1/catalogue/options/compat", {}, /formule.*obligatoire/i);
    await refus("POST", "/api/v1/catalogue/options/compat", { idFormule: 1 }, /option.*obligatoire/i);
    await refus("POST", "/api/v1/catalogue/options/compat", { idFormule: "1", idOption: 2 }, /formule.*nombre entier/i);
    await refus("POST", "/api/v1/catalogue/options/compat", { idFormule: 1, idOption: [2] }, /option.*nombre entier/i);
    await refus("POST", "/api/v1/catalogue/options/compat", { idFormule: { a: 1 }, idOption: 2 }, /formule.*nombre entier/i);
    await refus("POST", "/api/v1/catalogue/options/compat", { idFormule: 0, idOption: 2 }, /formule/i);
  });
});

describe("POST /api/v1/catalogue/kits : créer un kit", () => {
  it("nomme le champ manquant, la règle de prix absente ou inconnue", async () => {
    await refus("POST", "/api/v1/catalogue/kits", {}, /famille.*obligatoire/i);
    await refus("POST", "/api/v1/catalogue/kits", { idFamille: [1], libelle: "K" }, /famille.*nombre entier/i);
    await refus("POST", "/api/v1/catalogue/kits", { idFamille, libelle: "Sans règle" }, /règle de prix.*obligatoire/i);
    await refus("POST", "/api/v1/catalogue/kits", { idFamille, libelle: "Règle inconnue", reglePrix: "BITCOIN" }, /règle de prix.*(invalide|attendu)/i);
    await refus("POST", "/api/v1/catalogue/kits", { idFamille, libelle: "Règle objet", reglePrix: { a: 1 } }, /règle de prix.*(invalide|attendu)/i);
    await refus("POST", "/api/v1/catalogue/kits", { idFamille, libelle: ["K"], reglePrix: "PRIX_FIXE" }, /libellé.*texte/i);
  });

  it("un kit valide se crée toujours", async () => {
    const { statut } = await appeler("POST", "/api/v1/catalogue/kits", { idFamille, libelle: "Kit valide", reglePrix: "PRIX_FIXE", prixFixe: 5000 });
    expect(statut).toBe(201);
  });
});

describe("POST /api/v1/apporteurs/:id/reglements : règlement de commission", () => {
  it("nomme le montant ou le mode invalide, même quand le corps est truffé de types inattendus", async () => {
    await refus("POST", `/api/v1/apporteurs/${idApporteur}/reglements`, {}, /montant/i);
    await refus("POST", `/api/v1/apporteurs/${idApporteur}/reglements`, { montant: [5], modePaiement: "CASH" }, /montant/i);
    await refus("POST", `/api/v1/apporteurs/${idApporteur}/reglements`, { montant: 100, modePaiement: ["CASH"] }, /mode de paiement/i);
    await refus("POST", `/api/v1/apporteurs/${idApporteur}/reglements`, { montant: 100, modePaiement: "CASH", reference: { a: 1 } }, /référence.*texte/i);
  });

  // l'auteur du règlement vient de la session : le client ne choisit pas qui a payé l'apporteur
  it("l'auteur enregistré est l'utilisateur connecté, quoi que dise le corps de la requête", async () => {
    for (const faux of [idCaissier, 99999, [1], { a: 1 }, "x"]) {
      const { statut, corps } = await appeler("POST", `/api/v1/apporteurs/${idApporteur}/reglements`, { montant: 1000, modePaiement: "CASH", utilisateurId: faux });
      expect(statut, JSON.stringify(corps)).toBe(201);
      expect(corps.utilisateurId).toBe(idAdmin);
    }
    const enBase = db.select().from(schema.reglementCommission).all().filter((r) => r.montant === 1000);
    expect(enBase).toHaveLength(5);
    expect(enBase.every((r) => r.utilisateurId === idAdmin)).toBe(true);
  });
});

describe("règlement d'apporteur : l'apporteur est celui de l'adresse", () => {
  it("un apporteurId dans le corps ne remplace pas celui de l'URL", async () => {
    const autre = creerApporteur(db, { nom: "Autre Apporteur", tauxCommissionDefaut: 500 }).idApporteur;
    for (const faux of [autre, [idApporteur], { a: 1 }, "x"]) {
      const { statut, corps } = await appeler("POST", `/api/v1/apporteurs/${idApporteur}/reglements`, { montant: 10, modePaiement: "CASH", apporteurId: faux });
      expect(statut, JSON.stringify(corps)).toBe(201);
      expect(corps.apporteurId).toBe(idApporteur);
    }
    expect(db.select().from(schema.reglementCommission).where(eq(schema.reglementCommission.apporteurId, autre)).all()).toHaveLength(0);
  });
});

describe("POST /api/v1/utilisateurs/:id/mot-de-passe : réinitialiser un mot de passe", () => {
  it("dit que le mot de passe est obligatoire ou doit être un texte", async () => {
    await refus("POST", `/api/v1/utilisateurs/${idCaissier}/mot-de-passe`, {}, /mot de passe.*obligatoire/i);
    for (const faux of [123, ["abc"], { a: 1 }, true, null]) await refus("POST", `/api/v1/utilisateurs/${idCaissier}/mot-de-passe`, { motDePasse: faux }, /mot de passe.*(obligatoire|texte)/i);
  });
});

describe("POST /api/v1/stock/transferts : transférer du stock", () => {
  it("nomme le champ manquant ou mal typé", async () => {
    await refus("POST", "/api/v1/stock/transferts", {}, /produit.*obligatoire/i);
    await refus("POST", "/api/v1/stock/transferts", { idProduitSource: idProduit }, /boutique.*obligatoire/i);
    await refus("POST", "/api/v1/stock/transferts", { idProduitSource: idProduit, siteDestinationId: idAutreSite }, /quantité.*obligatoire/i);
    await refus("POST", "/api/v1/stock/transferts", { idProduitSource: [idProduit], siteDestinationId: idAutreSite, quantite: 1 }, /produit.*nombre entier/i);
    await refus("POST", "/api/v1/stock/transferts", { idProduitSource: idProduit, siteDestinationId: [idAutreSite], quantite: 1 }, /boutique.*nombre entier/i);
    await refus("POST", "/api/v1/stock/transferts", { idProduitSource: idProduit, siteDestinationId: idAutreSite, quantite: "5" }, /quantité.*nombre entier/i);
    await refus("POST", "/api/v1/stock/transferts", { idProduitSource: idProduit, siteDestinationId: idAutreSite, quantite: 1, motif: { a: 1 } }, /motif.*texte/i);
  });
});

describe("POST /api/v1/utilisateurs : créer un compte", () => {
  const base = { nom: "Nom", prenom: "Prénom", identifiant: "nouveau.compte", motDePasse: "motdepasse-secret", role: "CAISSIER" };

  it("nomme le champ manquant ou mal typé", async () => {
    await refus("POST", "/api/v1/utilisateurs", { ...base, siteId: [siteId] }, /site.*nombre entier/i);
    await refus("POST", "/api/v1/utilisateurs", { ...base, siteId: { a: 1 } }, /site.*nombre entier/i);
    await refus("POST", "/api/v1/utilisateurs", { ...base, motDePasse: undefined }, /mot de passe.*obligatoire/i);
    await refus("POST", "/api/v1/utilisateurs", { ...base, motDePasse: ["abc"] }, /mot de passe.*(obligatoire|texte)/i);
    await refus("POST", "/api/v1/utilisateurs", { ...base, identifiant: ["x"] }, /identifiant.*texte/i);
    await refus("POST", "/api/v1/utilisateurs", { ...base, nom: { a: 1 } }, /nom.*texte/i);
    await refus("POST", "/api/v1/utilisateurs", { ...base, role: ["ADMINISTRATEUR"] }, /rôle/i);
    await refus("POST", "/api/v1/utilisateurs", { ...base, idApporteur: [1] }, /apporteur.*nombre entier/i);
  });

  it("un compte valide se crée toujours", async () => {
    const { statut } = await appeler("POST", "/api/v1/utilisateurs", base);
    expect(statut).toBe(201);
  });
});

describe("POST /api/v1/produits/import-csv : enveloppe du fichier", () => {
  it("le contenu doit être un texte, et le dit", async () => {
    await refus("POST", "/api/v1/produits/import-csv", {}, /contenu.*CSV.*(obligatoire|texte)/i);
    for (const faux of [123, null, ["Type;Libelle"], { a: 1 }, true]) await refus("POST", "/api/v1/produits/import-csv", { contenuCsv: faux }, /contenu.*CSV.*(obligatoire|texte)/i);
  });
});
