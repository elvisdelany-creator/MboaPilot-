import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "./test-utils/db.js";
import { buildApp } from "./app.js";
import { creerUtilisateur } from "./modules/utilisateurs/utilisateur.repository.js";
import * as schema from "./db/schema.js";

// Mode hébergé : le serveur est joignable depuis Internet, derrière un proxy HTTPS. Ces tests fixent ce qu'il ajoute par rapport à un poste local.
const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";
const BON = "motdepasse-secret";

let db: Db;
let siteId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Paul", identifiant: "admin1", motDePasse: BON, role: "ADMINISTRATEUR" });
});

const heberge = (options = {}) => buildApp(db, { jwtSecret: JWT_SECRET_TEST, modeHeberge: true, faireConfianceAuProxy: 1, ...options });

// une requête telle que le proxy HTTPS la transmet : adresse du visiteur et protocole annoncés dans les en-têtes
const via = (app: FastifyInstance, requete: { method: "GET" | "POST"; url: string; payload?: object }, adresse = "41.202.0.1", proto = "https") =>
  app.inject({ ...requete, headers: { "x-forwarded-for": adresse, "x-forwarded-proto": proto } });

const connexion = (app: FastifyInstance, identifiant: string, motDePasse: string, adresse?: string) =>
  via(app, { method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse } }, adresse);

describe("verrou par compte et adresse : personne ne peut bloquer l'administrateur à distance", () => {
  it("5 mots de passe faux depuis une adresse bloquent cette adresse, même avec le bon mot de passe ensuite", async () => {
    const app = heberge();
    for (let i = 0; i < 5; i++) expect((await connexion(app, "admin1", "faux", "203.0.113.9")).statusCode).toBe(401);

    const refus = await connexion(app, "admin1", BON, "203.0.113.9");

    expect(refus.statusCode).toBe(401);
    expect(refus.json().erreur).toMatch(/verrouillé/i);
    expect(Number(refus.headers["retry-after"])).toBeGreaterThan(0);
  }, 60_000);

  it("l'administrateur reste connectable depuis sa boutique pendant que l'attaquant est bloqué", async () => {
    const app = heberge();
    for (let i = 0; i < 6; i++) await connexion(app, "admin1", "faux", "203.0.113.9");

    const boutique = await connexion(app, "admin1", BON, "41.202.0.1");

    expect(boutique.statusCode).toBe(200);
    expect(boutique.json().utilisateur.identifiant).toBe("admin1");
  }, 60_000);

  it("le compte lui-même n'est jamais verrouillé en base : les autres adresses ne sont pas touchées", async () => {
    const app = heberge();
    for (let i = 0; i < 6; i++) await connexion(app, "admin1", "faux", "203.0.113.9");

    const compte = db.select().from(schema.utilisateur).where(eq(schema.utilisateur.identifiant, "admin1")).get()!;
    expect(compte.verrouilleJusqua).toBeNull();
    expect(compte.tentativesEchouees).toBe(0);
  }, 60_000);

  it("une connexion réussie remet le compteur à zéro", async () => {
    const app = heberge();
    for (let i = 0; i < 4; i++) await connexion(app, "admin1", "faux", "203.0.113.9");
    expect((await connexion(app, "admin1", BON, "203.0.113.9")).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) await connexion(app, "admin1", "faux", "203.0.113.9");

    expect((await connexion(app, "admin1", BON, "203.0.113.9")).statusCode).toBe(200);
  }, 60_000);

  it("un identifiant inconnu se verrouille exactement comme un vrai : on ne peut pas deviner quels comptes existent", async () => {
    const app = heberge();
    for (let i = 0; i < 5; i++) await connexion(app, "fantome", "faux", "203.0.113.9");

    const refus = await connexion(app, "fantome", "faux", "203.0.113.9");

    expect(refus.statusCode).toBe(401);
    expect(refus.json().erreur).toMatch(/verrouillé/i);
  }, 60_000);

  it("hors mode hébergé, le verrouillage par compte reste celui d'avant (poste local : une seule adresse)", async () => {
    const local = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    for (let i = 0; i < 5; i++) await local.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "admin1", motDePasse: "faux" } });

    const compte = db.select().from(schema.utilisateur).where(eq(schema.utilisateur.identifiant, "admin1")).get()!;
    expect(compte.verrouilleJusqua).not.toBeNull();
  }, 60_000);
});

describe("plafonds de débit par adresse", () => {
  it("10 tentatives de connexion par minute et par adresse, puis 429 ; une autre adresse n'est pas touchée", async () => {
    const app = heberge();
    // des identifiants différents : on teste le plafond de débit, pas le verrou par compte
    for (let i = 0; i < 10; i++) expect((await connexion(app, `inconnu${i}`, "faux", "203.0.113.9")).statusCode).toBe(401);

    const refus = await connexion(app, "inconnu10", "faux", "203.0.113.9");
    expect(refus.statusCode).toBe(429);
    expect(Number(refus.headers["retry-after"])).toBeGreaterThan(0);
    expect((await connexion(app, "admin1", BON, "41.202.0.1")).statusCode).toBe(200);
  }, 90_000);

  it("le plafond général laisse largement travailler une boutique (plusieurs postes derrière une même adresse)", async () => {
    const app = heberge();
    let refus = 0;
    for (let i = 0; i < 300; i++) if ((await via(app, { method: "GET", url: "/api/v1/installation/etat" })).statusCode === 429) refus += 1;

    expect(refus).toBe(0);
  }, 60_000);
});

describe("HTTPS", () => {
  it("ajoute HSTS aux réponses servies en HTTPS", async () => {
    const reponse = await via(heberge(), { method: "GET", url: "/api/v1/installation/etat" });
    expect(reponse.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
  });

  it("refuse l'API quand le proxy annonce du HTTP simple : un mot de passe ne doit jamais circuler en clair", async () => {
    const reponse = await via(heberge(), { method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "admin1", motDePasse: BON } }, "41.202.0.1", "http");

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().erreur).toMatch(/https/i);
    expect(reponse.headers["strict-transport-security"]).toBeUndefined();
  });

  it("une requête sans protocole annoncé (sonde de santé locale du conteneur) n'est pas refusée", async () => {
    const reponse = await heberge().inject({ method: "GET", url: "/api/v1/installation/etat" });
    expect(reponse.statusCode).toBe(200);
  });

  it("hors mode hébergé, ni HSTS ni refus du HTTP : un poste de caisse local est servi en HTTP", async () => {
    const local = buildApp(db, { jwtSecret: JWT_SECRET_TEST, faireConfianceAuProxy: 1 });
    const reponse = await via(local, { method: "GET", url: "/api/v1/installation/etat" }, "41.202.0.1", "http");

    expect(reponse.statusCode).toBe(200);
    expect(reponse.headers["strict-transport-security"]).toBeUndefined();
  });
});

describe("ce que le mode hébergé n'autorise pas", () => {
  it("ne peut pas tourner avec la démo publique", () => {
    expect(() => buildApp(db, { jwtSecret: JWT_SECRET_TEST, modeHeberge: true, modeDemo: true })).toThrow(/démo/i);
  });

  it("refuse l'assistant d'installation : un serveur neuf exposé serait pris par le premier venu ; on y restaure sa base", async () => {
    const vide = creerDbTest();
    const app = buildApp(vide, { jwtSecret: JWT_SECRET_TEST, modeHeberge: true, faireConfianceAuProxy: 1 });

    const reponse = await via(app, {
      method: "POST",
      url: "/api/v1/installation",
      payload: { nomEntreprise: "Pirate", nomSite: "Site", administrateur: { nom: "X", prenom: "Y", identifiant: "pirate", motDePasse: "motdepasse-pirate-1" } },
    });

    expect(reponse.statusCode).toBe(403);
    expect(reponse.json().erreur).toMatch(/restaur/i);
    expect(vide.select().from(schema.utilisateur).all()).toHaveLength(0);
  });

  it("n'ouvre pas le simulateur Mobile Money : il déclarerait payé tout paiement", async () => {
    const app = heberge();
    const token = (await connexion(app, "admin1", BON)).json().token as string;

    const reponse = await app.inject({ method: "GET", url: "/api/v1/paiement-mobile/disponibilite", headers: { authorization: `Bearer ${token}` } });

    expect(reponse.json()).toEqual({ disponible: false });
  });
});
