import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copierVersExterne } from "./copie-externe.js";

// Test grandeur nature « mise à jour du poste » : la copie de sécurité annonçait « Copie terminée » avec une sauvegarde vieille de trois mois,
// ignorait les sauvegardes rangées sur un autre disque, et échouait sur la racine d'une clé USB (« E:\ ») en accusant la clé.
const MAINTENANT = new Date("2026-11-28T18:00:00.000Z");
let racine: string;
let donnees: string;

const nomSauvegarde = (date: string) => `mboapilot-sauvegarde-${date.replace(/[:.]/g, "-")}.db`;
function poser(chemin: string, contenu = "x") {
  mkdirSync(join(chemin, ".."), { recursive: true });
  writeFileSync(chemin, contenu);
}

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), "mboapilot-test-copie-"));
  donnees = join(racine, "MboaPilot donnees");
  for (const f of ["mboapilot.db", "mboapilot.db-wal", "mboapilot.db-shm", ".jwt-secret", ".encryption-key", "sav-photos/p.png", "logos/l.png", "mboapilot.db.restauration-en-cours", `backups/${nomSauvegarde("2026-11-28T08:00:00.000Z")}.partiel`]) poser(join(donnees, f));
  poser(join(donnees, "backups", nomSauvegarde("2026-11-28T08:00:00.000Z")));
});
afterEach(() => rmSync(racine, { recursive: true, force: true }));

const copier = (destination: string, extra: Partial<Parameters<typeof copierVersExterne>[0]> = {}) =>
  copierVersExterne({ donnees, sauvegardes: join(donnees, "backups"), destination, maintenant: MAINTENANT, ...extra });
const contenu = (d: string) => (existsSync(d) ? readdirSync(d, { recursive: true }).map((f) => String(f).replaceAll("\\", "/")).sort() : []);
const texte = (r: { messages: string[] }) => r.messages.join("\n");

describe.skipIf(process.platform !== "win32")("copie de sécurité hors de l'ordinateur", () => {
  it("copie sauvegardes, clé de chiffrement, photos et logo, jamais la base en service ni les fichiers incomplets", () => {
    const cle = join(racine, "cle usb (2) & co");

    const r = copier(cle);

    expect(r.code).toBe(0);
    expect(contenu(cle)).toEqual([".encryption-key", "backups", `backups/${nomSauvegarde("2026-11-28T08:00:00.000Z")}`, "logos", "logos/l.png", "sav-photos", "sav-photos/p.png"]);
    expect(texte(r)).toMatch(/Copie termin/);
  });

  it("accepte une destination terminée par une barre oblique, comme la racine d'une clé", () => {
    const cle = join(racine, "racine-cle") + "\\";

    expect(copier(cle).code).toBe(0);
    expect(existsSync(join(cle, "backups"))).toBe(true);
  });

  it("copie les sauvegardes rangées sur un autre disque", () => {
    const secondDisque = join(racine, "second disque");
    rmSync(join(donnees, "backups"), { recursive: true });
    poser(join(secondDisque, nomSauvegarde("2026-11-28T09:00:00.000Z")));
    const cle = join(racine, "cle");

    const r = copier(cle, { sauvegardes: secondDisque });

    expect(r.code).toBe(0);
    expect(contenu(join(cle, "backups"))).toEqual([nomSauvegarde("2026-11-28T09:00:00.000Z")]);
  });

  it("avec un autre disque pour les sauvegardes, les restes du dossier habituel ne sont pas pris pour elles", () => {
    const secondDisque = join(racine, "second disque");
    poser(join(secondDisque, nomSauvegarde("2026-11-28T09:00:00.000Z")));
    const cle = join(racine, "cle");

    copier(cle, { sauvegardes: secondDisque });

    expect(contenu(join(cle, "backups"))).toEqual([nomSauvegarde("2026-11-28T09:00:00.000Z")]);
  });

  it("signale que la dernière sauvegarde est ancienne", () => {
    rmSync(join(donnees, "backups"), { recursive: true });
    poser(join(donnees, "backups", nomSauvegarde("2026-09-01T08:00:00.000Z")));

    const r = copier(join(racine, "cle"));

    expect(r.code).toBe(2);
    expect(texte(r)).toMatch(/ATTENTION.*88 jours.*Exporter mes données/s);
  });

  it("une sauvegarde de la veille suffit, même copiée le lendemain soir", () => {
    rmSync(join(donnees, "backups"), { recursive: true });
    poser(join(donnees, "backups", nomSauvegarde("2026-11-27T07:00:00.000Z")));

    expect(copier(join(racine, "cle")).code).toBe(0);
  });

  it("prévient quand il n'y a aucune sauvegarde", () => {
    rmSync(join(donnees, "backups"), { recursive: true });

    const r = copier(join(racine, "cle"));

    expect(r.code).toBe(2);
    expect(texte(r)).toMatch(/ATTENTION.*aucune sauvegarde/s);
  });

  it.each([
    ["dans le dossier des données", () => join(donnees, "copie")],
    ["le dossier des données lui-même", () => donnees.toUpperCase()],
  ])("refuse une destination %s", (_nom, destination) => {
    const avant = contenu(donnees);

    const r = copier(destination());

    expect(r.code).toBe(1);
    expect(texte(r)).toMatch(/hors de l'ordinateur|dossier des données/);
    expect(contenu(donnees)).toEqual(avant);
  });

  it("support absent : échec expliqué, sans attente interminable", () => {
    const r = copier("Q:\\MboaPilot-copie");

    expect(r.code).toBe(1);
    expect(texte(r)).toMatch(/ECHEC/);
  }, 30_000);

  it("dossier des données introuvable : dit lequel", () => {
    const r = copier(join(racine, "cle"), { donnees: join(racine, "absent") });

    expect(r.code).toBe(1);
    expect(texte(r)).toMatch(/introuvable.*absent/);
  });
});
