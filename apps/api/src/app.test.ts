import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "./test-utils/db.js";
import { buildApp } from "./app.js";
import { creerUtilisateur } from "./modules/utilisateurs/utilisateur.repository.js";
import * as schema from "./db/schema.js";

const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";

let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = creerUtilisateur(db, {
    siteId,
    nom: "A",
    prenom: "B",
    identifiant: "caissier1",
    motDePasse: "motdepasse-secret",
    role: "CAISSIER",
  }).idUser;
  const fam = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get();
  idFormule = db
    .insert(schema.formule)
    .values({ idFamille: fam.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 })
    .returning()
    .get().idFormule;
});

async function connecter(app: FastifyInstance, identifiant = "caissier1", motDePasse = "motdepasse-secret") {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse } });
  return reponse.json().token as string;
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("POST /api/v1/auth/login (2.5.1)", () => {
  it("renvoie un jeton et le profil utilisateur (sans le hash) pour des identifiants valides", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { identifiant: "caissier1", motDePasse: "motdepasse-secret" },
    });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json();
    expect(corps.token).toBeTypeOf("string");
    expect(corps.utilisateur.identifiant).toBe("caissier1");
    expect(corps.utilisateur).not.toHaveProperty("motDePasseHash");
  });

  it("renvoie 401 pour un mot de passe incorrect", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { identifiant: "caissier1", motDePasse: "faux" },
    });

    expect(reponse.statusCode).toBe(401);
  });
});

describe("Garde d'authentification (11.2 : RBAC de bout en bout, jamais uniquement côté interface)", () => {
  it("rejette une route métier sans jeton (401)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({ method: "GET", url: "/api/v1/catalogue" });

    expect(reponse.statusCode).toBe(401);
  });

  it("rejette un jeton invalide (401)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({
      method: "GET",
      url: "/api/v1/catalogue",
      headers: authHeader("jeton.invalide.forge"),
    });

    expect(reponse.statusCode).toBe(401);
  });

  it("rejette un rôle non autorisé sur une route de vente (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, {
      siteId,
      nom: "Tech",
      prenom: "SAV",
      identifiant: "sav1",
      motDePasse: "motdepasse-secret",
      role: "TECHNICIEN_SAV",
    });
    const token = await connecter(app, "sav1");

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });

    expect(reponse.statusCode).toBe(403);
  });
});

describe("POST /api/v1/recrutements", () => {
  it("crée un abonnement et renvoie 201", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });

    expect(reponse.statusCode).toBe(201);
    const corps = reponse.json();
    expect(corps.statutFacture).toBe("VALIDEE");
    expect(corps.numeroAbonnement).toBeTypeOf("number");
  });

  it("renvoie 404 si la formule n'existe pas", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "X", prenom: "Y", telephone: "600000000" },
        idFormule: 999999,
        montantEncaisse: 1000,
      },
    });

    expect(reponse.statusCode).toBe(404);
  });
});

describe("POST /api/v1/abonnements/:numeroAbonnement/reabonnements", () => {
  it("réabonne et renvoie 200", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });
    const { numeroAbonnement } = creation.json();

    const reponse = await app.inject({
      method: "POST",
      url: `/api/v1/abonnements/${numeroAbonnement}/reabonnements`,
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui: "2025-12-20", montantEncaisse: 13000 },
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().statutFacture).toBe("VALIDEE");
  });

  it("renvoie 404 pour un numéro d'abonnement inconnu", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/abonnements/999999/reabonnements",
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui: "2025-12-20", montantEncaisse: 1000 },
    });

    expect(reponse.statusCode).toBe(404);
  });
});

describe("GET /api/v1/abonnes/:idAbonne/abonnements", () => {
  it("renvoie les abonnements de l'abonné, pour la détection recrutement vs réabonnement (9.2)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });
    const { numeroAbonnement } = creation.json();
    const abonnes = await app.inject({
      method: "GET",
      url: `/api/v1/abonnes?siteId=${siteId}&q=Ndongo`,
      headers: authHeader(token),
    });
    const idAbonne = abonnes.json()[0].idAbonne;

    const reponse = await app.inject({
      method: "GET",
      url: `/api/v1/abonnes/${idAbonne}/abonnements`,
      headers: authHeader(token),
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toEqual([expect.objectContaining({ numeroAbonnement })]);
  });
});

describe("GET /api/v1/catalogue", () => {
  it("renvoie les familles avec leurs formules", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: authHeader(token) });

    expect(reponse.statusCode).toBe(200);
    const catalogue = reponse.json();
    expect(catalogue.some((f: { libelle: string }) => f.libelle === "DSTV")).toBe(true);
  });
});

describe("GET /api/v1/abonnes", () => {
  it("recherche unifiée par nom, cloisonnée par site", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });

    const reponse = await app.inject({
      method: "GET",
      url: `/api/v1/abonnes?siteId=${siteId}&q=Ndongo`,
      headers: authHeader(token),
    });

    expect(reponse.statusCode).toBe(200);
    const resultats = reponse.json();
    expect(resultats).toHaveLength(1);
    expect(resultats[0].nom).toBe("Nga Ndongo");
  });
});

describe("POST /api/v1/jobs/quotidien (4.3, 4.4, 6.2)", () => {
  it("réservé à l'administrateur : 403 pour un caissier", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({ method: "POST", url: "/api/v1/jobs/quotidien", headers: authHeader(token) });

    expect(reponse.statusCode).toBe(403);
  });

  it("exécute le job et renvoie le récapitulatif pour un administrateur", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, {
      siteId,
      nom: "Admin",
      prenom: "Démo",
      identifiant: "admin1",
      motDePasse: "motdepasse-secret",
      role: "ADMINISTRATEUR",
    });
    const token = await connecter(app, "admin1");

    const reponse = await app.inject({ method: "POST", url: "/api/v1/jobs/quotidien", headers: authHeader(token) });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toEqual(
      expect.objectContaining({ abonnementsExpires: expect.any(Number), alertesCreees: expect.any(Number) })
    );
  });
});

describe("GET /api/v1/alertes-echeance", () => {
  it("renvoie la liste des alertes déclenchées pour le site", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-10-01",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });
    expect(creation.statusCode).toBe(201);

    await app.inject({ method: "POST", url: "/api/v1/jobs/quotidien", headers: authHeader(token) });

    const reponse = await app.inject({ method: "GET", url: `/api/v1/alertes-echeance?siteId=${siteId}`, headers: authHeader(token) });

    expect(reponse.statusCode).toBe(200);
    expect(Array.isArray(reponse.json())).toBe(true);
  });
});
