import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lireCheminDonneesTxt, memoriserDossierHabituel, resoudreDossierBoutique, verifierDossierHabituel } from "./dossier-boutique.js";

// Test grandeur nature « mise à jour du poste » : une espace en fin de ligne, un enregistrement « Unicode » ou une ligne vide dans donnees.txt
// faisaient démarrer MboaPilot sur une boutique vide, sans le moindre avertissement.
//
// Chaque essai travaille sur une « racine » jetable : jamais sur le donnees.txt du vrai projet.
let racine: string;
const dossier = () => join(racine, "Données boutique");

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), "mboapilot-test-dossier-"));
});
afterEach(() => rmSync(racine, { recursive: true, force: true }));

const utf16 = (texte: string, grandBoutien = false) => {
  const corps = Buffer.from(texte, "utf16le");
  if (grandBoutien) corps.swap16();
  return Buffer.concat([Buffer.from(grandBoutien ? [0xfe, 0xff] : [0xff, 0xfe]), corps]);
};

describe("lireCheminDonneesTxt : le chemin tel qu'un gérant peut l'avoir enregistré", () => {
  it.each<[string, (c: string) => Buffer]>([
    ["simple", (c) => Buffer.from(`${c}\r\n`)],
    ["sans retour à la ligne", (c) => Buffer.from(c)],
    ["avec des espaces et une tabulation autour", (c) => Buffer.from(` \t${c}  \t\r\n`)],
    ["avec une espace insécable", (c) => Buffer.from(`${c}\u00a0\r\n`)],
    ["après des lignes vides", (c) => Buffer.from(`\r\n\r\n${c}\r\n`)],
    ["entre guillemets", (c) => Buffer.from(`"${c}"\r\n`)],
    ["terminé par une barre oblique", (c) => Buffer.from(`${c}\\\r\n`)],
    ["UTF-8 avec BOM", (c) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${c}\r\n`)])],
    ["« Unicode » (UTF-16)", (c) => utf16(`${c}\r\n`)],
    ["UTF-16 gros-boutien", (c) => utf16(`${c}\r\n`, true)],
    ["UTF-16 sans BOM", (c) => Buffer.from(`${c}\r\n`, "utf16le")],
    ["ANSI (accents Windows)", (c) => Buffer.from(`${c}\r\n`, "latin1")],
    ["écrit comme une variable", (c) => Buffer.from(`MBOAPILOT_DATA_DIR=${c}\r\n`)],
    ["écrit comme une commande set", (c) => Buffer.from(`set MBOAPILOT_DATA_DIR = "${c}"\r\n`)],
  ])("%s", (_nom, fabriquer) => {
    expect(lireCheminDonneesTxt(fabriquer(dossier()))).toBe(dossier());
  });

  it.each([
    ["vide", "", /vide/],
    ["fait d'espaces", "  \r\n \r\n", /vide/],
    ["un chemin incomplet", "MboaPilot-donnees\r\n", /chemin complet/],
    ["un lecteur sans barre oblique", "C:MboaPilot-donnees\r\n", /chemin complet/],
    ["des caractères impossibles", "C:\\Mboa<Pilot>?\r\n", /chemin complet|caractère/],
  ])("refuse un fichier %s avec un message clair", (_nom, contenu, message) => {
    expect(() => lireCheminDonneesTxt(Buffer.from(contenu))).toThrow(message);
  });
});

describe("resoudreDossierBoutique : d'où viennent les données", () => {
  const resoudre = (env: Record<string, string | undefined> = {}) => resoudreDossierBoutique({ racine, env });

  it("sans réglage : apps/api/data du projet", () => {
    expect(resoudre()).toEqual({ dossier: join(racine, "apps", "api", "data"), origine: "défaut" });
  });

  it("donnees.txt, puis la variable qui reste prioritaire (espaces ignorées)", () => {
    writeFileSync(join(racine, "donnees.txt"), `${dossier()}\r\n`);
    expect(resoudre()).toEqual({ dossier: dossier(), origine: "donnees.txt" });

    expect(resoudre({ MBOAPILOT_DATA_DIR: `${join(racine, "autre")}  ` })).toEqual({ dossier: join(racine, "autre"), origine: "variable" });
  });

  it("un fichier donnees.txt.txt est signalé au lieu d'être ignoré", () => {
    writeFileSync(join(racine, "donnees.txt.txt"), `${dossier()}\r\n`);

    expect(() => resoudre()).toThrow(/donnees\.txt\.txt.*renommez/is);
  });

  it("un donnees.txt illisible arrête tout plutôt que de prendre le dossier par défaut", () => {
    writeFileSync(join(racine, "donnees.txt"), "\r\n");

    expect(() => resoudre()).toThrow(/donnees\.txt/);
  });
});

describe("dossier habituel : une boutique ne disparaît pas sans prévenir", () => {
  const boutique = (nom: string) => {
    const d = join(racine, nom);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "mboapilot.db"), "base");
    return d;
  };
  const resolution = (d: string, origine: "donnees.txt" | "défaut" | "variable" = "donnees.txt") => ({ dossier: d, origine });
  const marque = () => join(racine, ".dernier-dossier-donnees");

  it("mémorise le dossier d'une boutique installée, et seulement celle-là", () => {
    memoriserDossierHabituel(racine, resolution(boutique("a")), false);
    expect(existsSync(marque())).toBe(false);

    memoriserDossierHabituel(racine, resolution(boutique("a")), true);
    expect(readFileSync(marque(), "utf8").trim()).toBe(join(racine, "a"));
  });

  it("refuse d'ouvrir un dossier vide quand la boutique est toujours à l'ancien emplacement (faute de frappe, fichier perdu)", () => {
    memoriserDossierHabituel(racine, resolution(boutique("a")), true);

    expect(() => verifierDossierHabituel(racine, resolution(join(racine, "a-faute")))).toThrow(/dossier des données a changé.*vide/is);
    expect(() => verifierDossierHabituel(racine, resolution(join(racine, "apps", "api", "data"), "défaut"))).toThrow(/donnees\.txt/);
  });

  // le guide conseille de garder l'ancien apps/api/data après avoir déplacé les données : donnees.txt perdu, il rouvrait cette vieille copie
  it("donnees.txt disparu : refuse aussi de rouvrir une ancienne base restée dans le dossier par défaut", () => {
    memoriserDossierHabituel(racine, resolution(boutique("a")), true);

    expect(() => verifierDossierHabituel(racine, resolution(boutique("apps/api/data"), "défaut"))).toThrow(/a changé.*donnees\.txt/is);
  });

  it("données déplacées (les deux dossiers ont une base) : on prévient sans bloquer", () => {
    memoriserDossierHabituel(racine, resolution(boutique("a")), true);

    expect(verifierDossierHabituel(racine, resolution(boutique("b")))).toEqual([expect.stringMatching(/a changé/)]);
  });

  it.each([
    ["rien de mémorisé", () => {}],
    ["l'ancien emplacement n'a plus de base (nouvel ordinateur)", () => writeFileSync(marque(), "Z:\\ancien-poste\\donnees\r\n")],
  ])("laisse passer : %s", (_nom, preparer) => {
    preparer();

    expect(verifierDossierHabituel(racine, resolution(join(racine, "neuf")))).toEqual([]);
  });

  it("même dossier écrit autrement : rien à signaler", () => {
    const a = boutique("a");
    memoriserDossierHabituel(racine, resolution(a), true);

    expect(verifierDossierHabituel(racine, resolution(a.toUpperCase()))).toEqual([]);
  });

  it("dossier imposé par une variable (essais, développement) : ni contrôle ni mémorisation", () => {
    memoriserDossierHabituel(racine, resolution(boutique("a")), true);
    const essai = resolution(join(racine, "essai"), "variable");

    expect(verifierDossierHabituel(racine, essai)).toEqual([]);
    memoriserDossierHabituel(racine, essai, true);
    expect(readFileSync(marque(), "utf8").trim()).toBe(join(racine, "a"));
  });
});
