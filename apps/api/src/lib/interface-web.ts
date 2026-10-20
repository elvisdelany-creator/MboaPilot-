import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyReply, FastifyRequest } from "fastify";
import { gestionnaireRouteInconnue } from "./erreurs-api.js";

// Un seul processus, une seule adresse : l'API sert aussi l'interface web construite (`npm run build` dans apps/web).
// Petit serveur de fichiers statiques écrit ici plutôt que de dépendre d'un paquet de plus pour une dizaine de types.
const TYPES_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

// Dossier de l'interface construite : MBOAPILOT_WEB_DIR, sinon apps/web/dist du dépôt ; `undefined` s'il n'existe pas
// (l'API reste utilisable seule, avec le serveur de développement de l'interface).
export function resoudreDossierInterfaceWeb(): string | undefined {
  const candidat = process.env.MBOAPILOT_WEB_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../web/dist");
  return existsSync(join(candidat, "index.html")) ? candidat : undefined;
}

function envoyerFichier(reply: FastifyReply, chemin: string, extension: string, immuable: boolean): void {
  reply
    .code(200)
    .header("Content-Type", TYPES_MIME[extension] ?? "application/octet-stream")
    // les fichiers construits portent une empreinte dans leur nom : cache long ; index.html doit toujours être relu
    .header("Cache-Control", immuable ? "public, max-age=31536000, immutable" : "no-cache")
    .header("X-Content-Type-Options", "nosniff")
    .send(readFileSync(chemin));
}

// Gestionnaire des routes inconnues : une page ou un fichier de l'interface pour une lecture, le 404 JSON de l'API sinon.
export function creerGestionnaireInterfaceWeb(dossier: string) {
  const racine = resolve(dossier);

  return function servirInterfaceWeb(request: FastifyRequest, reply: FastifyReply): void {
    const chemin = request.url.split("?")[0];
    if ((request.method !== "GET" && request.method !== "HEAD") || chemin.startsWith("/api/")) {
      gestionnaireRouteInconnue(request, reply);
      return;
    }

    let relatif: string;
    try {
      relatif = decodeURIComponent(chemin);
    } catch {
      gestionnaireRouteInconnue(request, reply);
      return;
    }
    // jamais de remontée de dossier (« .. », y compris encodé ou avec \), de fichier caché ni d'octet nul
    const segments = relatif.split(/[\/]+/).filter(Boolean);
    if (relatif.includes("\0") || segments.some((s) => s === ".." || s.startsWith("."))) {
      gestionnaireRouteInconnue(request, reply);
      return;
    }

    const candidat = resolve(racine, ...segments);
    const extension = extname(candidat).toLowerCase();
    if (candidat.startsWith(racine + sep) && existsSync(candidat) && statSync(candidat).isFile()) {
      envoyerFichier(reply, candidat, extension, segments[0] === "assets");
      return;
    }

    // page de l'application (QR de vérification, etc.) : l'interface gère elle-même le chemin ; un fichier
    // absent avec une extension reste un vrai 404, pas la page d'accueil
    if (extension === "") {
      envoyerFichier(reply, join(racine, "index.html"), ".html", false);
      return;
    }
    gestionnaireRouteInconnue(request, reply);
  };
}
