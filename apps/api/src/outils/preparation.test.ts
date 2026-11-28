import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Test grandeur nature « mise à jour du poste » : le lanceur comparait des dates de fichiers. Une version copiée avec ses dates d'origine (retour
// en arrière, archive), un fichier supprimé ou la seule page index.html modifiée ne déclenchaient rien : l'ancienne interface restait en service.
// Le script du lanceur compare désormais le contenu.
const SCRIPT = pathToFileURL(join(fileURLToPath(new URL("../../../..", import.meta.url)), "scripts", "preparation.mjs")).href;
const { executer } = (await import(SCRIPT)) as { executer: (commande: string, racine: string) => number };

let racine: string;
const poser = (chemin: string, contenu: string, jours = 30) => {
  const fichier = join(racine, chemin);
  mkdirSync(dirname(fichier), { recursive: true });
  writeFileSync(fichier, contenu);
  const date = new Date(Date.now() - jours * 86_400_000);
  utimesSync(fichier, date, date);
};

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), "mboapilot-test-preparation-"));
  poser("package.json", "{}");
  poser("package-lock.json", "v1");
  poser("apps/web/index.html", "<html>");
  poser("apps/web/src/App.tsx", "v1");
  poser("apps/web/src/Autre.tsx", "v1");
  poser("packages/shared/src/regle.ts", "v1");
  poser("apps/api/src/server.ts", "v1");
  poser("node_modules/.package-lock.json", "v1", 20);
  poser("apps/web/dist/index.html", "construite", 20);
  executer("installe", racine);
  executer("construit", racine);
});
afterEach(() => rmSync(racine, { recursive: true, force: true }));

const A_JOUR = 0;
const INSTALLER = 10;
const CONSTRUIRE = 11;
const verifier = () => executer("verifier", racine);

describe("ce que le lanceur doit refaire après une mise à jour", () => {
  it("rien de nouveau : rien à refaire", () => {
    expect(verifier()).toBe(A_JOUR);
  });

  it("de simples changements de dates ne déclenchent rien", () => {
    poser("apps/web/src/App.tsx", "v1", 0);
    poser("package-lock.json", "v1", 0);

    expect(verifier()).toBe(A_JOUR);
  });

  it.each([
    ["une source de l'interface", () => poser("apps/web/src/App.tsx", "v2")],
    ["la page d'accueil seule", () => poser("apps/web/index.html", "<html lang='fr'>")],
    ["le code partagé", () => poser("packages/shared/src/regle.ts", "v2")],
    ["un fichier supprimé", () => rmSync(join(racine, "apps/web/src/Autre.tsx"))],
    ["un fichier ajouté", () => poser("apps/web/src/Neuf.tsx", "v1")],
    ["un retour à une version plus ancienne, avec ses anciennes dates", () => poser("apps/web/src/App.tsx", "v0", 90)],
    ["l'interface construite disparue", () => rmSync(join(racine, "apps/web/dist"), { recursive: true })],
  ])("reconstruit : %s", (_nom, changer) => {
    changer();

    expect(verifier()).toBe(CONSTRUIRE);
  });

  // réinstaller exige Internet : seule la liste verrouillée des composants le justifie
  it("une commande modifiée dans un package.json ne demande pas de réinstaller", () => {
    poser("apps/api/package.json", '{"scripts":{"neuf":"x"}}');

    expect(verifier()).toBe(CONSTRUIRE);
  });

  it("les mêmes fichiers avec d'autres fins de ligne ne demandent rien", () => {
    const lignes = (fin: string) => ["a", "b", ""].join(fin);
    poser("package-lock.json", lignes(String.fromCharCode(10)));
    executer("installe", racine);
    executer("construit", racine);
    poser("package-lock.json", lignes(String.fromCharCode(13, 10)));

    expect(verifier()).toBe(A_JOUR);
  });

  it.each([
    ["la liste des composants a changé, même avec une date ancienne", () => poser("package-lock.json", "v0", 90)],
    ["les composants ne sont pas installés", () => rmSync(join(racine, "node_modules"), { recursive: true })],
  ])("réinstalle : %s", (_nom, changer) => {
    changer();

    expect(verifier()).toBe(INSTALLER);
  });

  // premier lancement après l'arrivée de ce script : sans empreinte enregistrée, ne pas exiger Internet si rien n'indique un changement
  it("sans empreinte des composants : les dates font foi une dernière fois, puis l'empreinte est adoptée", () => {
    rmSync(join(racine, "node_modules/.empreinte-composants"));
    expect(verifier()).toBe(A_JOUR);

    poser("package-lock.json", "v2", 90);
    expect(verifier()).toBe(INSTALLER);
  });

  it("sans empreinte des composants et liste plus récente que l'installation : réinstalle", () => {
    rmSync(join(racine, "node_modules/.empreinte-composants"));
    poser("package-lock.json", "v2", 1);

    expect(verifier()).toBe(INSTALLER);
  });

  it("sans empreinte de l'interface : reconstruit", () => {
    rmSync(join(racine, "apps/web/dist/.empreinte-interface"));

    expect(verifier()).toBe(CONSTRUIRE);
  });
});

describe("mise à jour pendant que MboaPilot tourne", () => {
  const ATTENTE = 12;

  it("rien à signaler tant que la version en service est celle du dossier", () => {
    executer("en-service", racine);

    expect(executer("en-attente", racine)).toBe(A_JOUR);
  });

  it.each([
    ["le serveur", () => poser("apps/api/src/server.ts", "v2", 90)],
    ["l'interface", () => poser("apps/web/src/App.tsx", "v2")],
  ])("signale une mise à jour qui touche %s", (_nom, changer) => {
    executer("en-service", racine);
    changer();

    expect(executer("en-attente", racine)).toBe(ATTENTE);
  });

  it("version en service inconnue (ancien lanceur) : signale aussi", () => {
    expect(executer("en-attente", racine)).toBe(ATTENTE);
  });

  it("refuse une commande inconnue", () => {
    expect(() => executer("autre", racine)).toThrow(/inconnue/);
  });
});
