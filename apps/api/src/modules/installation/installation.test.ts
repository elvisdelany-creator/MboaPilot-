import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { buildApp } from "../../app.js";
import { authentifier } from "../auth/auth.service.js";
import { installationNecessaire, installer } from "./installation.service.js";

// Première installation d'une boutique : une base neuve ne contenait ni entreprise, ni site, ni compte, et le seul moyen
// d'entrer était le jeu de démonstration (admin / admin1234). L'assistant crée l'entreprise, le site et le premier
// administrateur, avec un mot de passe choisi par la boutique.
let db: Db;

const SAISIE = {
  nomEntreprise: "Boutique Mboa",
  nomSite: "Boutique principale",
  adresseSite: "Akwa, Douala",
  administrateur: { prenom: "Marie", nom: "Tchoua", identifiant: "Marie.Tchoua", motDePasse: "Motdepasse-Boutique-1" },
};

beforeEach(() => {
  db = creerDbTest();
});

describe("installationNecessaire", () => {
  it("est vrai sur une base neuve, faux dès qu'un compte existe", () => {
    expect(installationNecessaire(db)).toBe(true);

    installer(db, SAISIE);

    expect(installationNecessaire(db)).toBe(false);
  });
});

describe("installer", () => {
  it("crée l'entreprise, le site et un administrateur actif dont le mot de passe fonctionne", () => {
    installer(db, SAISIE);

    const entreprise = db.select().from(schema.entreprise).get();
    const site = db.select().from(schema.site).get();
    const admin = db.select().from(schema.utilisateur).get();
    expect(entreprise?.nom).toBe("Boutique Mboa");
    expect(site).toMatchObject({ nom: "Boutique principale", adresse: "Akwa, Douala", idEntreprise: entreprise?.idEntreprise });
    expect(admin).toMatchObject({ role: "ADMINISTRATEUR", actif: 1, siteId: site?.idSite, identifiant: "marie.tchoua", nom: "Tchoua", prenom: "Marie" });
    expect(authentifier(db, "marie.tchoua", "Motdepasse-Boutique-1").role).toBe("ADMINISTRATEUR");
    expect(admin?.motDePasseHash).not.toContain("Motdepasse-Boutique-1");
  });

  it("n'accepte jamais une deuxième installation et ne crée rien de plus", () => {
    installer(db, SAISIE);

    expect(() => installer(db, { ...SAISIE, nomEntreprise: "Autre", administrateur: { ...SAISIE.administrateur, identifiant: "pirate" } })).toThrow(/déjà installée/i);

    expect(db.select().from(schema.entreprise).all()).toHaveLength(1);
    expect(db.select().from(schema.utilisateur).all()).toHaveLength(1);
  });

  it("refuse une saisie invalide sans rien laisser derrière (tout ou rien)", () => {
    expect(() => installer(db, { ...SAISIE, nomEntreprise: "   " })).toThrow(/entreprise/i);
    expect(() => installer(db, { ...SAISIE, nomSite: "" })).toThrow(/site|boutique/i);
    expect(() => installer(db, { ...SAISIE, administrateur: { ...SAISIE.administrateur, motDePasse: "court" } })).toThrow();
    expect(() => installer(db, { ...SAISIE, administrateur: { ...SAISIE.administrateur, identifiant: "deux mots" } })).toThrow();

    expect(db.select().from(schema.entreprise).all()).toHaveLength(0);
    expect(db.select().from(schema.site).all()).toHaveLength(0);
    expect(db.select().from(schema.utilisateur).all()).toHaveLength(0);
    expect(installationNecessaire(db)).toBe(true);
  });

  it("refuse des champs qui ne sont pas du texte", () => {
    expect(() => installer(db, { ...SAISIE, nomEntreprise: 42 as never })).toThrow();
    expect(() => installer(db, null as never)).toThrow();
    expect(() => installer(db, { ...SAISIE, administrateur: undefined as never })).toThrow();
  });

  it("réutilise une entreprise et un site déjà présents mais sans compte (installation interrompue)", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Ancien nom" }).returning().get();
    db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Ancien site" }).run();

    installer(db, SAISIE);

    expect(db.select().from(schema.entreprise).all()).toHaveLength(1);
    expect(db.select().from(schema.site).all()).toHaveLength(1);
    expect(db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, ent.idEntreprise)).get()?.nom).toBe("Boutique Mboa");
    expect(db.select().from(schema.site).get()?.nom).toBe("Boutique principale");
  });

  it("l'adresse est facultative", () => {
    installer(db, { ...SAISIE, adresseSite: undefined });

    expect(db.select().from(schema.site).get()?.adresse).toBeNull();
  });
});

describe("routes d'installation (publiques, tant que rien n'est installé)", () => {
  const app = () => buildApp(db, { jwtSecret: "secret-de-test" });

  it("GET /api/v1/installation/etat répond sans connexion", async () => {
    const avant = await app().inject({ method: "GET", url: "/api/v1/installation/etat" });
    expect(avant.statusCode).toBe(200);
    expect(avant.json()).toEqual({ installee: false });

    installer(db, SAISIE);

    const apres = await app().inject({ method: "GET", url: "/api/v1/installation/etat" });
    expect(apres.json()).toEqual({ installee: true });
  });

  it("POST /api/v1/installation installe et renvoie une session d'administrateur directement utilisable", async () => {
    const serveur = app();

    const reponse = await serveur.inject({ method: "POST", url: "/api/v1/installation", payload: SAISIE });

    expect(reponse.statusCode).toBe(201);
    const { token, utilisateur } = reponse.json();
    expect(utilisateur).toMatchObject({ identifiant: "marie.tchoua", role: "ADMINISTRATEUR" });
    expect(utilisateur).not.toHaveProperty("motDePasseHash");
    const moi = await serveur.inject({ method: "GET", url: "/api/v1/auth/moi", headers: { authorization: `Bearer ${token}` } });
    expect(moi.statusCode).toBe(200);
    expect(moi.json().role).toBe("ADMINISTRATEUR");
  });

  it("POST /api/v1/installation répond 409 quand l'application est déjà installée", async () => {
    installer(db, SAISIE);

    const reponse = await app().inject({ method: "POST", url: "/api/v1/installation", payload: { ...SAISIE, administrateur: { ...SAISIE.administrateur, identifiant: "pirate" } } });

    expect(reponse.statusCode).toBe(409);
    expect(reponse.json().erreur).toMatch(/déjà installée/i);
    expect(db.select().from(schema.utilisateur).all()).toHaveLength(1);
  });

  it("répond 400 (jamais 500) à une saisie invalide, avec le message lisible", async () => {
    const mdpCourt = await app().inject({ method: "POST", url: "/api/v1/installation", payload: { ...SAISIE, administrateur: { ...SAISIE.administrateur, motDePasse: "court" } } });
    expect(mdpCourt.statusCode).toBe(400);
    expect(mdpCourt.json().erreur).toMatch(/caractères/i);

    const sansCorps = await app().inject({ method: "POST", url: "/api/v1/installation" });
    expect(sansCorps.statusCode).toBe(400);
  });
});
