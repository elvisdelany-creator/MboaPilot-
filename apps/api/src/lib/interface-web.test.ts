import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creerDbTest } from "../test-utils/db.js";
import { buildApp } from "../app.js";

// Un seul processus, une seule adresse : l'API sert aussi l'interface web construite (apps/web/dist). Sans cela
// `npm run build` produisait des fichiers que rien ne servait, et seul le serveur de développement fonctionnait.
let racine: string;
let dossierWeb: string;

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), "mboapilot-test-web-"));
  dossierWeb = join(racine, "dist");
  mkdirSync(join(dossierWeb, "assets"), { recursive: true });
  writeFileSync(join(dossierWeb, "index.html"), "<!doctype html><title>MboaPilot</title><div id=root>INDEX</div>");
  writeFileSync(join(dossierWeb, "assets", "app-abc123.js"), "console.log('app');");
  writeFileSync(join(dossierWeb, "assets", "style-def456.css"), "body{margin:0}");
  writeFileSync(join(dossierWeb, "assets", "police.woff2"), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
  writeFileSync(join(dossierWeb, ".cache-interne"), "NE-DOIT-JAMAIS-ETRE-SERVI");
  writeFileSync(join(racine, "secret.txt"), "HORS-DU-DOSSIER-WEB"); // à côté de dist/ : ne doit jamais sortir
});
afterEach(() => rmSync(racine, { recursive: true, force: true }));

const app = () => buildApp(creerDbTest(), { jwtSecret: "secret-de-test", dossierInterfaceWeb: dossierWeb });

describe("service de l'interface web par l'API", () => {
  it("sert index.html à la racine, sans cache (une mise à jour doit être vue tout de suite)", async () => {
    const reponse = await app().inject({ method: "GET", url: "/" });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.headers["content-type"]).toMatch(/text\/html/);
    expect(reponse.headers["cache-control"]).toMatch(/no-cache/);
    expect(reponse.body).toContain("INDEX");
  });

  it("sert les fichiers construits avec le bon type et un cache long (leur nom contient une empreinte)", async () => {
    const js = await app().inject({ method: "GET", url: "/assets/app-abc123.js" });
    const css = await app().inject({ method: "GET", url: "/assets/style-def456.css" });
    const police = await app().inject({ method: "GET", url: "/assets/police.woff2" });

    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
    expect(js.headers["cache-control"]).toMatch(/immutable/);
    expect(css.headers["content-type"]).toMatch(/text\/css/);
    expect(police.headers["content-type"]).toMatch(/font\/woff2/);
  });

  it("renvoie index.html pour une page de l'application (chemin sans extension), par exemple le QR de vérification", async () => {
    const reponse = await app().inject({ method: "GET", url: "/verification/12/abcdef" });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.body).toContain("INDEX");
  });

  it("répond 404 JSON à une route d'API inconnue, jamais la page d'accueil", async () => {
    const reponse = await app().inject({ method: "GET", url: "/api/v1/inconnu" });

    expect(reponse.statusCode).toBe(404);
    expect(reponse.json()).toEqual({ erreur: "Ressource introuvable" });
  });

  it("répond 404 à un fichier absent avec extension (pas de repli sur index.html)", async () => {
    const reponse = await app().inject({ method: "GET", url: "/assets/absent.js" });

    expect(reponse.statusCode).toBe(404);
    expect(reponse.body).not.toContain("INDEX");
  });

  it.each(["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/..%5c..%5csecret.txt"])(
    "ne sort jamais du dossier de l'interface (%s)",
    async (url) => {
      const reponse = await app().inject({ method: "GET", url });

      expect(reponse.body).not.toContain("HORS-DU-DOSSIER-WEB");
    }
  );

  it("ne sert jamais un fichier caché", async () => {
    const reponse = await app().inject({ method: "GET", url: "/.cache-interne" });

    expect(reponse.body).not.toContain("NE-DOIT-JAMAIS-ETRE-SERVI");
    expect(reponse.statusCode).not.toBe(200);
  });

  it("ne répond qu'aux lectures : un POST inconnu reste un 404 JSON", async () => {
    const reponse = await app().inject({ method: "POST", url: "/", payload: {} });

    expect(reponse.statusCode).toBe(404);
    expect(reponse.json()).toEqual({ erreur: "Ressource introuvable" });
  });

  it("accepte HEAD", async () => {
    const reponse = await app().inject({ method: "HEAD", url: "/" });

    expect(reponse.statusCode).toBe(200);
  });

  it("ajoute nosniff aux fichiers servis", async () => {
    const reponse = await app().inject({ method: "GET", url: "/assets/app-abc123.js" });

    expect(reponse.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sans dossier d'interface configuré, tout chemin inconnu reste un 404 JSON (comportement des tests et de l'API seule)", async () => {
    const sansWeb = buildApp(creerDbTest(), { jwtSecret: "secret-de-test" });

    const reponse = await sansWeb.inject({ method: "GET", url: "/" });

    expect(reponse.statusCode).toBe(404);
    expect(reponse.json()).toEqual({ erreur: "Ressource introuvable" });
  });

  it("n'affecte pas les routes d'API existantes", async () => {
    const reponse = await app().inject({ method: "GET", url: "/api/v1/auth/moi" });

    expect(reponse.statusCode).toBe(401);
  });
});
