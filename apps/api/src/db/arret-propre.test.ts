import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import type { Db } from "./types.js";
import { checkpointerBase, installerArretPropre, planifierCheckpoint } from "./arret-propre.js";

// En mode WAL, les écritures récentes vivent dans le fichier mboapilot.db-wal : tant qu'un point de contrôle ne les a pas
// fusionnées, le fichier mboapilot.db SEUL (copié sur une clé USB, ou après la fermeture brutale de la fenêtre) est vide ou
// périmé. Constaté : .db de 4 Ko et 0 vente, pour un -wal de 830 Ko.
let dossier: string;
let cheminBase: string;
let db: Db;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), "mboapilot-test-wal-"));
  cheminBase = join(dossier, "mboapilot.db");
  const sqlite = new Database(cheminBase);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).run();
});
afterEach(() => {
  vi.useRealTimers();
  try {
    db.$client.close();
  } catch {
    /* déjà fermée */
  }
  rmSync(dossier, { recursive: true, force: true });
});

// ce qu'obtient une boutique qui copie seulement mboapilot.db : on lit cette copie à part
function lireCopieDuFichierSeul(): { entreprises: number; noms: string[] } | "base illisible" {
  const copie = join(dossier, `copie-${Math.random().toString(36).slice(2)}.db`);
  copyFileSync(cheminBase, copie);
  let lecteur: Database.Database | undefined;
  try {
    lecteur = new Database(copie, { readonly: true });
    const noms = (lecteur.prepare("select nom from entreprise").all() as { nom: string }[]).map((e) => e.nom);
    return { entreprises: noms.length, noms };
  } catch {
    return "base illisible";
  } finally {
    lecteur?.close(); // jamais laissée ouverte : sous Windows, elle bloquerait la suppression du dossier de test
  }
}

describe("avant tout point de contrôle (le problème constaté)", () => {
  it("la copie du seul fichier .db ne contient pas les écritures récentes", () => {
    expect(lireCopieDuFichierSeul()).not.toEqual({ entreprises: 1, noms: ["Boutique Test"] });
  });
});

describe("checkpointerBase", () => {
  it("fusionne le journal dans le fichier .db : la copie du .db seul contient alors toutes les données", () => {
    checkpointerBase(db);

    expect(lireCopieDuFichierSeul()).toEqual({ entreprises: 1, noms: ["Boutique Test"] });
    const wal = `${cheminBase}-wal`;
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
  });
});

describe("planifierCheckpoint", () => {
  it("fusionne le journal à intervalle régulier, y compris pour les écritures faites entre deux passages", () => {
    vi.useFakeTimers();
    const minuteur = planifierCheckpoint(db, 60_000);

    vi.advanceTimersByTime(60_000);
    expect(lireCopieDuFichierSeul()).toEqual({ entreprises: 1, noms: ["Boutique Test"] });

    db.insert(schema.entreprise).values({ nom: "Seconde entreprise" }).run();
    vi.advanceTimersByTime(60_000);
    expect(lireCopieDuFichierSeul()).toMatchObject({ entreprises: 2 });
    clearInterval(minuteur);
  });

  it("ne lève jamais d'exception (un point de contrôle manqué ne doit pas arrêter la caisse)", () => {
    vi.useFakeTimers();
    const erreur = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const minuteur = planifierCheckpoint(db, 1000);
    db.$client.close(); // base fermée : le prochain passage échoue

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(erreur).toHaveBeenCalled();
    clearInterval(minuteur);
  });
});

describe("installerArretPropre", () => {
  function preparer() {
    const processus = Object.assign(new EventEmitter(), { exit: vi.fn() });
    const app = { close: vi.fn(async () => undefined) };
    installerArretPropre(app, db, processus as never);
    return { processus, app };
  }

  it.each(["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"])("sur %s : arrête le serveur, fusionne le journal, ferme la base et quitte", async (signal) => {
    const { processus, app } = preparer();

    processus.emit(signal);
    await vi.waitFor(() => expect(processus.exit).toHaveBeenCalledWith(0));

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(db.$client.open).toBe(false);
    expect(lireCopieDuFichierSeul()).toEqual({ entreprises: 1, noms: ["Boutique Test"] });
    expect(existsSync(`${cheminBase}-wal`)).toBe(false); // fermeture propre : plus de journal
  });

  it("un second signal pendant l'arrêt ne relance rien", async () => {
    const { processus, app } = preparer();

    processus.emit("SIGINT");
    processus.emit("SIGINT");
    processus.emit("SIGTERM");
    await vi.waitFor(() => expect(processus.exit).toHaveBeenCalled());

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(processus.exit).toHaveBeenCalledTimes(1);
  });

  it("quitte quand même (code 1) si l'arrêt du serveur échoue, sans laisser la caisse bloquée", async () => {
    const processus = Object.assign(new EventEmitter(), { exit: vi.fn() });
    const erreur = vi.spyOn(console, "error").mockImplementation(() => undefined);
    installerArretPropre({ close: vi.fn(async () => { throw new Error("échec simulé"); }) }, db, processus as never);

    processus.emit("SIGTERM");
    await vi.waitFor(() => expect(processus.exit).toHaveBeenCalled());

    expect(processus.exit).toHaveBeenCalledWith(1);
    expect(erreur).toHaveBeenCalled();
  });
});
