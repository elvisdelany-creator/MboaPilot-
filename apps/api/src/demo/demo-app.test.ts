import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "../test-utils/db.js";
import { buildApp } from "../app.js";
import { creerUtilisateur } from "../modules/utilisateurs/utilisateur.repository.js";
import * as schema from "../db/schema.js";
import { COMPTES_DEMO } from "./mode-demo.js";

const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";

let db: Db;
let siteId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Démo" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site principal" }).returning().get().idSite;
  creerUtilisateur(db, { siteId, nom: "Gérant", prenom: "Démo", identifiant: "gerant.demo", motDePasse: "motdepasse-secret", role: "GERANT" });
});

const demo = (options: Partial<Parameters<typeof buildApp>[1]> = {}) => buildApp(db, { jwtSecret: JWT_SECRET_TEST, modeDemo: true, ...options });

async function connecter(app: FastifyInstance) {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "gerant.demo", motDePasse: "motdepasse-secret" } });
  return { authorization: `Bearer ${reponse.json().token as string}` };
}

describe("GET /api/v1/demo", () => {
  it("annonce la démo et ses comptes à un visiteur sans jeton", async () => {
    const reponse = await demo().inject({ method: "GET", url: "/api/v1/demo" });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toEqual({ actif: true, comptes: COMPTES_DEMO.map(({ role, libelle, identifiant, motDePasse }) => ({ role, libelle, identifiant, motDePasse })) });
  });

  it("hors démo, répond actif: false et ne divulgue aucun compte", async () => {
    const reponse = await buildApp(db, { jwtSecret: JWT_SECRET_TEST }).inject({ method: "GET", url: "/api/v1/demo" });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toEqual({ actif: false });
  });
});

describe("écritures sensibles refusées en démo", () => {
  it("refuse de changer le mot de passe d'un compte partagé : le suivant ne pourrait plus se connecter", async () => {
    const app = demo();
    const entetes = await connecter(app);

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mot-de-passe",
      headers: entetes,
      payload: { motDePasseActuel: "motdepasse-secret", nouveauMotDePasse: "Nouveau-mdp-1234" },
    });

    expect(reponse.statusCode).toBe(403);
    expect(reponse.json().erreur).toMatch(/démo/i);
    // le mot de passe d'origine fonctionne toujours
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "gerant.demo", motDePasse: "motdepasse-secret" } })).statusCode).toBe(200);
  });

  it.each([
    ["POST", "/api/v1/utilisateurs"],
    ["POST", "/api/v1/sites"],
    ["PUT", "/api/v1/licence/expiration"],
    ["POST", "/api/v1/sauvegarde/export"],
    ["PATCH", "/api/v1/entreprise"],
  ])("refuse %s %s (403), même sans session", async (methode, url) => {
    const reponse = await demo().inject({ method: methode as "POST", url, payload: {} });

    expect(reponse.statusCode).toBe(403);
    expect(reponse.json().erreur).toMatch(/démo/i);
  });

  it("hors démo, le changement de mot de passe fonctionne comme avant", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const entetes = await connecter(app);

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mot-de-passe",
      headers: entetes,
      payload: { motDePasseActuel: "motdepasse-secret", nouveauMotDePasse: "Nouveau-mdp-1234" },
    });

    expect(reponse.statusCode).toBe(200);
  });

  it("laisse les lectures et les parcours métier à essayer", async () => {
    const app = demo();
    const entetes = await connecter(app);

    expect((await app.inject({ method: "GET", url: "/api/v1/auth/moi", headers: entetes })).statusCode).toBe(200);
    const produit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, coutRevient: 1000 }).returning().get();
    const vente = await app.inject({ method: "POST", url: "/api/v1/ventes", headers: entetes, payload: { lignes: [{ idProduit: produit.idProduit, quantite: 1 }], montantEncaisse: 2500 } });
    expect(vente.statusCode).toBe(201);
  });
});

describe("verrouillage des comptes en démo", () => {
  it("ne verrouille jamais un compte de démo : un visiteur qui se trompe ne bloque pas les suivants", async () => {
    const app = demo();
    for (let i = 0; i < 8; i++) {
      const echec = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "gerant.demo", motDePasse: "mauvais" } });
      expect(echec.statusCode).toBe(401);
      expect(echec.json().erreur).toBe("Identifiants invalides"); // jamais « compte verrouillé »
    }

    const bon = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "gerant.demo", motDePasse: "motdepasse-secret" } });
    expect(bon.statusCode).toBe(200);
  });

  it("hors démo, le verrouillage après 5 échecs reste en vigueur", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    for (let i = 0; i < 5; i++) await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "gerant.demo", motDePasse: "mauvais" } });

    const bon = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "gerant.demo", motDePasse: "motdepasse-secret" } });
    expect(bon.statusCode).toBe(401);
    expect(bon.json().erreur).toMatch(/verrouillé/i);
  });
});

describe("limitation de débit par adresse", () => {
  const limites = { generale: { fenetreMs: 60_000, maximum: 5 }, connexion: { fenetreMs: 60_000, maximum: 3 }, televersement: { fenetreMs: 60_000, maximum: 2 } };

  it("refuse (429) au-delà du plafond général, avec le délai avant de réessayer", async () => {
    const app = demo({ limiteDebit: limites });
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: "GET", url: "/api/v1/demo" })).statusCode).toBe(200);

    const refus = await app.inject({ method: "GET", url: "/api/v1/demo" });

    expect(refus.statusCode).toBe(429);
    expect(refus.json().erreur).toMatch(/trop de requêtes/i);
    expect(Number(refus.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("plafonne les tentatives de connexion plus sévèrement que le reste", async () => {
    const app = demo({ limiteDebit: limites });
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "x", motDePasse: "y" } })).statusCode).toBe(401);

    const refus = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "x", motDePasse: "y" } });

    expect(refus.statusCode).toBe(429);
    // les autres appels du même visiteur ne sont pas bloqués par le plafond de connexion
    expect((await app.inject({ method: "GET", url: "/api/v1/demo" })).statusCode).toBe(200);
  });

  it("plafonne les envois de fichiers bien plus bas que le reste : ils écrivent sur le disque du serveur", async () => {
    const app = demo({ limiteDebit: { ...limites, generale: { fenetreMs: 60_000, maximum: 100 } } });
    const entetes = await connecter(app);

    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: "POST", url: "/api/v1/produits/import-csv", headers: entetes, payload: {} })).statusCode);

    expect(codes.slice(0, 2).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(2)).toEqual([429, 429]);
    // le reste de l'API reste disponible
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/moi", headers: entetes })).statusCode).toBe(200);
  });

  it("ne limite pas l'interface web servie ni les routes hors /api/", async () => {
    const app = demo({ limiteDebit: { generale: { fenetreMs: 60_000, maximum: 1 }, connexion: { fenetreMs: 60_000, maximum: 1 }, televersement: { fenetreMs: 60_000, maximum: 1 } } });
    await app.inject({ method: "GET", url: "/api/v1/demo" });

    for (let i = 0; i < 4; i++) expect((await app.inject({ method: "GET", url: "/page-inconnue" })).statusCode).not.toBe(429);
  });

  it("ignore l'en-tête X-Forwarded-For sans proxy de confiance : on ne contourne pas la limite en changeant d'adresse annoncée", async () => {
    const app = demo({ limiteDebit: limites });
    for (let i = 0; i < 5; i++) await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-for": `203.0.113.${i}` } });

    const refus = await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-for": "198.51.100.9" } });

    expect(refus.statusCode).toBe(429);
  });

  it("derrière un proxy de confiance, compte chaque visiteur selon son adresse réelle", async () => {
    const app = demo({ limiteDebit: limites, faireConfianceAuProxy: true });
    for (let i = 0; i < 5; i++) await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-for": "203.0.113.1" } });

    const autreVisiteur = await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-for": "203.0.113.2" } });
    const memeVisiteur = await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-for": "203.0.113.1" } });

    expect(autreVisiteur.statusCode).toBe(200);
    expect(memeVisiteur.statusCode).toBe(429);
  });

  // le proxy de l'hébergeur AJOUTE l'adresse qu'il voit à droite de X-Forwarded-For, sans retirer ce que le visiteur y a mis : l'adresse la
  // plus à gauche est celle que le visiteur annonce lui-même, la fiable est la dernière
  it("derrière un proxy de confiance, ignore les adresses que le visiteur ajoute lui-même à gauche de X-Forwarded-For", async () => {
    const app = demo({ limiteDebit: limites, faireConfianceAuProxy: true });
    for (let i = 0; i < 5; i++) await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-for": `10.0.0.${i}, 203.0.113.50` } });

    const refus = await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-for": "10.0.0.99, 203.0.113.50" } });

    expect(refus.statusCode).toBe(429); // même visiteur réel (203.0.113.50), quelles que soient les adresses inventées
  });

  it("accepte de faire confiance à plusieurs proxys successifs quand l'hébergeur en met plusieurs", async () => {
    const app = demo({ limiteDebit: limites, faireConfianceAuProxy: 2 });
    // client réel, puis deux proxys : l'adresse du client est la deuxième en partant de la droite
    for (let i = 0; i < 5; i++) await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-for": `203.0.113.7, 198.51.100.1` } });

    expect((await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.1" } })).statusCode).toBe(429);
    expect((await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-for": "203.0.113.8, 198.51.100.1" } })).statusCode).toBe(200);
  });

  it("hors démo et sans plafond demandé, aucune limite n'est appliquée", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    for (let i = 0; i < 50; i++) expect((await app.inject({ method: "GET", url: "/api/v1/demo" })).statusCode).toBe(200);
  });
});

describe("HSTS en démo", () => {
  it("demande au navigateur de n'utiliser que HTTPS quand la requête est arrivée en HTTPS par le proxy de confiance", async () => {
    const app = demo({ faireConfianceAuProxy: true });

    const https = await app.inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-proto": "https" } });
    const http = await app.inject({ method: "GET", url: "/api/v1/demo" });

    expect(https.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(http.headers["strict-transport-security"]).toBeUndefined();
  });

  it("hors démo, n'ajoute jamais HSTS : un poste de caisse local n'est pas servi en HTTPS", async () => {
    const reponse = await buildApp(db, { jwtSecret: JWT_SECRET_TEST, faireConfianceAuProxy: true }).inject({ method: "GET", url: "/api/v1/demo", headers: { "x-forwarded-proto": "https" } });

    expect(reponse.headers["strict-transport-security"]).toBeUndefined();
  });
});
