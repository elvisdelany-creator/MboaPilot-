import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerFixtureEtatVentes, type FixtureEtatVentes } from "../../test-utils/fixture-etat-ventes.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";

const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";
const MOT_DE_PASSE = "motdepasse-secret";
const QUERY = "du=2026-11-01&au=2026-11-30";
const ROUTES = ["/api/v1/etats/ventes", "/api/v1/etats/ventes/csv", "/api/v1/etats/ventes/pdf"];

let db: Db;
let app: FastifyInstance;
let fx: FixtureEtatVentes;
const jetons: Record<string, string> = {};

async function connecter(identifiant: string): Promise<string> {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse: MOT_DE_PASSE } });
  return reponse.json().token as string;
}
const get = (url: string, role?: string) => app.inject({ method: "GET", url, headers: role ? { authorization: `Bearer ${jetons[role]}` } : {} });

beforeAll(async () => {
  db = creerDbTest();
  fx = creerFixtureEtatVentes(db);
  for (const role of ["ADMINISTRATEUR", "GERANT", "COMPTABLE", "CAISSIER", "TECHNICIEN_SAV", "APPORTEUR"] as const) {
    creerUtilisateur(db, { siteId: fx.siteId, nom: role, prenom: "Test", identifiant: role.toLowerCase(), motDePasse: MOT_DE_PASSE, role });
  }
  creerUtilisateur(db, { siteId: fx.autreSiteId, nom: "Gerant", prenom: "Site B", identifiant: "gerant.b", motDePasse: MOT_DE_PASSE, role: "GERANT" });
  app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
  for (const role of ["ADMINISTRATEUR", "GERANT", "COMPTABLE", "CAISSIER", "TECHNICIEN_SAV", "APPORTEUR"]) jetons[role] = await connecter(role.toLowerCase());
  jetons["GERANT_B"] = await connecter("gerant.b");
}, 120_000);

describe("droits : le pilotage financier (Administrateur, Gérant, Comptable) et personne d'autre", () => {
  for (const role of ["ADMINISTRATEUR", "GERANT", "COMPTABLE"]) {
    it(`${role} reçoit l'état sous les trois formes (200)`, async () => {
      for (const route of ROUTES) expect((await get(`${route}?${QUERY}`, role)).statusCode, `${route} pour ${role}`).toBe(200);
    });
  }

  for (const role of ["CAISSIER", "TECHNICIEN_SAV", "APPORTEUR"]) {
    it(`${role} est refusé (403) sur les trois routes`, async () => {
      for (const route of ROUTES) expect((await get(`${route}?${QUERY}`, role)).statusCode, `${route} pour ${role}`).toBe(403);
    });
  }

  it("sans compte : 401 sur les trois routes", async () => {
    for (const route of ROUTES) expect((await get(`${route}?${QUERY}`)).statusCode, route).toBe(401);
  });
});

describe("GET /api/v1/etats/ventes (JSON)", () => {
  it("renvoie l'état complet de la période", async () => {
    const etat = (await get(`/api/v1/etats/ventes?${QUERY}`, "GERANT")).json();

    expect(etat.titre).toBe("État des ventes");
    expect(etat.periode).toEqual({ du: "2026-11-01", au: "2026-11-30" });
    expect(etat.sections.map((s: { titre: string }) => s.titre)).toEqual([
      "Récapitulatif par jour",
      "Répartition par famille d'activité",
      "Répartition par mode de paiement",
      "Détail facture par facture",
      "Totaux de la période",
    ]);
    expect(etat.sections[4].lignes[0]).toEqual(["Total TTC (net des avoirs)", 24900]);
  });

  it("refuse une période absente, invalide, inversée ou trop longue (400) avec un message clair", async () => {
    const message = async (requete: string) => {
      const reponse = await get(`/api/v1/etats/ventes${requete}`, "GERANT");
      expect(reponse.statusCode, requete).toBe(400);
      return reponse.json().erreur as string;
    };

    expect(await message("")).toMatch(/date de début/);
    expect(await message("?du=2026-02-30&au=2026-03-01")).toMatch(/date de début/);
    expect(await message("?du=2026-11-30&au=2026-11-01")).toMatch(/inversée/);
    expect(await message("?du=2025-01-01&au=2026-11-30")).toMatch(/trop longue/);
  });

  it("une période sans vente est un état valide, pas une erreur", async () => {
    const reponse = await get("/api/v1/etats/ventes?du=2026-01-01&au=2026-01-31", "COMPTABLE");

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().sections[0].lignes).toEqual([]);
  });

  it("la boutique est celle de la session : un siteId dans l'adresse est ignoré", async () => {
    const parSite = async (role: string, supplement: string) =>
      (await get(`/api/v1/etats/ventes?${QUERY}${supplement}`, role)).json().sections[4].lignes[0] as [string, number];

    expect(await parSite("GERANT", "")).toEqual(["Total TTC (net des avoirs)", 24900]);
    expect(await parSite("GERANT_B", "")).toEqual(["Total TTC (net des avoirs)", 7777]);
    expect(await parSite("GERANT_B", `&siteId=${fx.siteId}`)).toEqual(["Total TTC (net des avoirs)", 7777]); // jamais les ventes de la boutique A
  });
});

describe("GET /api/v1/etats/ventes/csv", () => {
  it("renvoie un CSV nommé d'après la période, avec le titre et les totaux", async () => {
    const reponse = await get(`/api/v1/etats/ventes/csv?${QUERY}`, "GERANT");

    expect(reponse.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(reponse.headers["content-disposition"]).toBe("attachment; filename=etat-des-ventes-2026-11-01-au-2026-11-30.csv");
    const lignes = reponse.body.split("\r\n");
    expect(lignes[0]).toBe("État des ventes");
    expect(lignes[1]).toBe("Période;du 01/11/2026 au 30/11/2026");
    expect(lignes).toContain("Total TTC (net des avoirs);24900");
  });

  it("une période invalide donne 400 et son message, pas un fichier", async () => {
    const reponse = await get("/api/v1/etats/ventes/csv?du=2026-11-30&au=2026-11-01", "GERANT");

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().erreur).toMatch(/inversée/);
  });
});

describe("GET /api/v1/etats/ventes/pdf", () => {
  it("renvoie un vrai PDF nommé d'après la période", async () => {
    const reponse = await get(`/api/v1/etats/ventes/pdf?${QUERY}`, "COMPTABLE");

    expect(reponse.headers["content-type"]).toBe("application/pdf");
    expect(reponse.headers["content-disposition"]).toBe("attachment; filename=etat-des-ventes-2026-11-01-au-2026-11-30.pdf");
    expect(reponse.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(reponse.rawPayload.length).toBeGreaterThan(1000);
  });

  it("une période invalide donne 400 et son message, pas un fichier", async () => {
    const reponse = await get("/api/v1/etats/ventes/pdf?du=2025-01-01&au=2026-11-30", "GERANT");

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().erreur).toMatch(/trop longue/);
  });
});
