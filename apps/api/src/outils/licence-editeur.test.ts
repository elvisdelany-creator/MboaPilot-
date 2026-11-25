import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { executerOutilLicence } from "./licence-editeur.js";
import { lireCle } from "../modules/licence/cle-renouvellement.js";

// Outil de l'éditeur : crée sa paire de clés (une fois) puis émet les clés de renouvellement. La clé privée ne doit jamais se retrouver dans
// le dépôt ni être écrasée par mégarde : sans elle, plus aucune boutique ne peut être renouvelée.
const INSTALLATION = "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a0c9d2";
let dossier: string;
let fichierPrive: string;
let fichierPublic: string;
let sorties: string[];
const executer = (...args: string[]) => executerOutilLicence(args, { fichierClePublique: fichierPublic, ecrire: (ligne) => sorties.push(ligne), aujourdHui: "2026-11-25" });
const clePubliqueInscrite = () => /CLE_PUBLIQUE_EDITEUR = "([^"]*)"/.exec(readFileSync(fichierPublic, "utf8"))![1];

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), "mboapilot-licence-"));
  fichierPrive = join(dossier, "cle-privee-editeur.pem");
  fichierPublic = join(dossier, "cle-publique-editeur.ts");
  writeFileSync(fichierPublic, '// en-tête\nexport const CLE_PUBLIQUE_EDITEUR = "";\n');
  sorties = [];
});
afterEach(() => rmSync(dossier, { recursive: true, force: true }));

describe("outil de licence : paire de clés", () => {
  it("écrit la clé privée où on le demande et inscrit la clé publique dans l'application", () => {
    executer("paire", "--sortie", fichierPrive);

    expect(readFileSync(fichierPrive, "utf8")).toContain("BEGIN PRIVATE KEY");
    expect(clePubliqueInscrite().length).toBeGreaterThan(40);
    expect(readFileSync(fichierPublic, "utf8")).toContain("// en-tête");
    expect(sorties.join("\n")).toMatch(/Sauvegardez/);
    expect(sorties.join("\n")).not.toContain("BEGIN PRIVATE KEY"); // la clé privée ne s'affiche jamais
  });

  it("n'écrase pas une clé privée existante", () => {
    writeFileSync(fichierPrive, "ancienne clé");
    expect(() => executer("paire", "--sortie", fichierPrive)).toThrow(/existe déjà/);
    expect(readFileSync(fichierPrive, "utf8")).toBe("ancienne clé");
    expect(clePubliqueInscrite()).toBe("");
  });

  it("ne remplace la clé publique déjà inscrite qu'avec --remplacer", () => {
    executer("paire", "--sortie", fichierPrive);
    const premiere = clePubliqueInscrite();

    expect(() => executer("paire", "--sortie", join(dossier, "autre.pem"))).toThrow(/déjà inscrite.*--remplacer/);
    expect(existsSync(join(dossier, "autre.pem"))).toBe(false);
    executer("paire", "--sortie", join(dossier, "autre.pem"), "--remplacer");
    expect(clePubliqueInscrite()).not.toBe(premiere);
  });

  it("refuse d'écrire la clé privée dans le dépôt de l'application", () => {
    const dansLeDepot = resolve(dirname(fileURLToPath(import.meta.url)), "cle-privee-essai.pem");
    expect(() => executer("paire", "--sortie", dansLeDepot)).toThrow(/hors du dépôt/);
    expect(existsSync(dansLeDepot)).toBe(false);
  });
});

describe("outil de licence : émettre une clé", () => {
  beforeEach(() => {
    executer("paire", "--sortie", fichierPrive);
    sorties = [];
  });

  it("produit une clé que l'application accepte, pour l'installation et l'échéance demandées", () => {
    executer("emettre", "--cle", fichierPrive, "--installation", INSTALLATION, "--expiration", "2027-12-31", "--palier", "PRO");

    const cle = sorties.find((l) => l.startsWith("MBOA1."))!;
    expect(lireCle(cle, clePubliqueInscrite())).toEqual({ installation: INSTALLATION, expiration: "2027-12-31", palier: "PRO", emise: "2026-11-25" });
  });

  it("date l'émission à l'instant près, pour départager deux clés du même jour", () => {
    executerOutilLicence(["emettre", "--cle", fichierPrive, "--installation", INSTALLATION.toUpperCase(), "--expiration", "2027-12-31", "--palier", "reseau"], {
      fichierClePublique: fichierPublic,
      ecrire: (ligne) => sorties.push(ligne),
      aujourdHui: "2026-11-25",
      horodatage: "2026-11-25T09:30:00.000Z",
    });
    expect(lireCle(sorties.find((l) => l.startsWith("MBOA1."))!, clePubliqueInscrite())).toMatchObject({ installation: INSTALLATION, palier: "RESEAU", emise: "2026-11-25T09:30:00.000Z" });
  });

  it("accepte une échéance à dix ans tout juste", () => {
    executer("emettre", "--cle", fichierPrive, "--installation", INSTALLATION, "--expiration", "2036-11-25", "--palier", "PRO");
    expect(sorties.some((l) => l.startsWith("MBOA1."))).toBe(true);
  });

  it.each([
    [["--installation", "abc", "--expiration", "2027-12-31"], /--cle/],
    [["--cle", "PRIVE", "--expiration", "2027-12-31"], /--installation/],
    [["--cle", "PRIVE", "--installation", "abc"], /--expiration/],
    [["--cle", "PRIVE", "--installation", INSTALLATION, "--expiration", "31/12/2027", "--palier", "PRO"], /réelle au format/],
    [["--cle", "PRIVE", "--installation", INSTALLATION, "--expiration", "2026-01-01", "--palier", "PRO"], /passée/],
    [["--cle", "PRIVE", "--installation", INSTALLATION, "--expiration", "2027-12-31", "--palier", "OR"], /formule/i],
    [["--cle", "PRIVE", "--installation", INSTALLATION, "--expiration", "2027-12-31"], /--palier/],
    [["--cle", "PRIVE", "--installation", INSTALLATION.slice(0, -4), "--expiration", "2027-12-31", "--palier", "PRO"], /identifiant d'installation est incomplet/],
    [["--cle", "PRIVE", "--installation", "ma-boutique", "--expiration", "2027-12-31", "--palier", "PRO"], /identifiant d'installation/],
    [["--cle", "PRIVE", "--installation", INSTALLATION, "--expiration", "2040-01-01", "--palier", "PRO"], /dépasse 10 ans/],
  ])("refuse une demande incomplète ou fausse (%s)", (args, message) => {
    expect(() => executer("emettre", ...args.map((a) => (a === "PRIVE" ? fichierPrive : a)))).toThrow(message);
    expect(sorties.some((l) => l.startsWith("MBOA1."))).toBe(false);
  });

  it("dit simplement qu'un fichier de clé privée est introuvable", () => {
    expect(() => executer("emettre", "--cle", join(dossier, "absent.pem"), "--installation", INSTALLATION, "--expiration", "2027-12-31", "--palier", "PRO")).toThrow(/Clé privée introuvable.*absent\.pem/);
  });

  // une paire régénérée sans mettre à jour l'application produirait des clés que personne n'accepte
  it("prévient quand la clé privée ne correspond pas à la clé publique inscrite", () => {
    executer("paire", "--sortie", join(dossier, "nouvelle.pem"), "--remplacer");
    expect(() => executer("emettre", "--cle", fichierPrive, "--installation", INSTALLATION, "--expiration", "2027-12-31", "--palier", "PRO")).toThrow(/ne correspond pas/);
  });

  it("une commande inconnue rappelle le mode d'emploi", () => {
    expect(() => executer("renouveler")).toThrow(/paire.*emettre/s);
  });
});
