import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creerDbTest } from "../test-utils/db.js";
import { buildApp } from "../app.js";

// L'API sert maintenant l'interface, et la fiche de vérification peut être exposée sur Internet : sans en-têtes de
// sécurité, l'application pouvait être affichée dans le cadre d'un site tiers (clickjacking), les réponses de l'API
// (données de clients) pouvaient être gardées en cache par un navigateur partagé ou un proxy, et aucune politique de
// contenu ne limitait les scripts qu'une page peut exécuter.
let racine: string;

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), "mboapilot-test-entetes-"));
  mkdirSync(join(racine, "assets"));
  writeFileSync(join(racine, "index.html"), "<!doctype html><title>MboaPilot</title><div id=root></div>");
  writeFileSync(join(racine, "assets", "app-abc.js"), "console.log(1)");
});
afterEach(() => rmSync(racine, { recursive: true, force: true }));

const app = () => buildApp(creerDbTest(), { jwtSecret: "secret-de-test", dossierInterfaceWeb: racine });

describe("en-têtes de sécurité", () => {
  it("la page de l'interface interdit l'affichage dans un cadre et limite les sources de contenu", async () => {
    const reponse = await app().inject({ method: "GET", url: "/" });

    expect(reponse.headers["x-frame-options"]).toBe("DENY");
    expect(reponse.headers["referrer-policy"]).toBe("no-referrer");
    expect(reponse.headers["x-content-type-options"]).toBe("nosniff");
    const csp = String(reponse.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    // le QR (data:), les logos et photos (blob:) s'affichent ; aucun script ni style venu d'ailleurs
    expect(csp).toMatch(/img-src [^;]*'self'[^;]*data:[^;]*blob:/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).not.toMatch(/script-src[^;]*\*/);
  });

  it("les pages de l'application (QR de vérification) portent les mêmes protections", async () => {
    const reponse = await app().inject({ method: "GET", url: "/verification/12/abc" });

    expect(reponse.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(reponse.headers["x-frame-options"]).toBe("DENY");
  });

  it("les réponses de l'API ne sont jamais mises en cache et ne sont pas interprétables comme autre chose que du JSON", async () => {
    const reponse = await app().inject({ method: "GET", url: "/api/v1/installation/etat" });

    expect(reponse.headers["cache-control"]).toBe("no-store");
    expect(reponse.headers["x-content-type-options"]).toBe("nosniff");
    expect(reponse.headers["x-frame-options"]).toBe("DENY");
    expect(reponse.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("les erreurs de l'API (401, 404) sont protégées de la même façon", async () => {
    const non = await app().inject({ method: "GET", url: "/api/v1/auth/moi" });
    const inconnue = await app().inject({ method: "GET", url: "/api/v1/inconnu" });

    for (const reponse of [non, inconnue]) {
      expect(reponse.headers["cache-control"]).toBe("no-store");
      expect(reponse.headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("les fichiers construits gardent leur cache long (le no-store ne vise que l'API)", async () => {
    const reponse = await app().inject({ method: "GET", url: "/assets/app-abc.js" });

    expect(reponse.headers["cache-control"]).toMatch(/immutable/);
    expect(reponse.headers["x-content-type-options"]).toBe("nosniff");
    expect(reponse.headers["content-security-policy"]).toBeUndefined(); // la politique est portée par la page, pas par chaque script
  });

  it("l'API seule (sans interface) est protégée aussi", async () => {
    const sansWeb = buildApp(creerDbTest(), { jwtSecret: "secret-de-test" });

    const reponse = await sansWeb.inject({ method: "GET", url: "/api/v1/installation/etat" });

    expect(reponse.headers["x-frame-options"]).toBe("DENY");
    expect(reponse.headers["cache-control"]).toBe("no-store");
  });
});
