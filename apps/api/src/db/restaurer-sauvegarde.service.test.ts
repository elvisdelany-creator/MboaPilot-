import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { restaurerSauvegarde } from "./restaurer-sauvegarde.service.js";

let dossier: string;

function creerBase(nom: string, valeur: string): string {
  const chemin = join(dossier, nom);
  const base = new Database(chemin);
  base.exec("create table t(v text)");
  base.prepare("insert into t values (?)").run(valeur);
  base.close();
  return chemin;
}

function lire(chemin: string): string {
  const base = new Database(chemin, { readonly: true });
  try {
    return (base.prepare("select v from t").get() as { v: string }).v;
  } finally {
    base.close();
  }
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), "mboapilot-test-restauration-"));
});
afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

describe("restaurerSauvegarde (2.6)", () => {
  it("remplace la base et conserve l'ancienne sous .avant-restauration", () => {
    const base = creerBase("mboapilot.db", "actuelle");
    const sauvegarde = creerBase("A.db", "sauvegarde-A");

    restaurerSauvegarde(sauvegarde, base);

    expect(lire(base)).toBe("sauvegarde-A");
    expect(lire(`${base}.avant-restauration`)).toBe("actuelle");
  });

  it("refuse un fichier qui n'est pas une base saine, sans toucher à la base actuelle", () => {
    const base = creerBase("mboapilot.db", "actuelle");
    const faux = join(dossier, "faux.db");
    writeFileSync(faux, "ceci n'est pas une base SQLite, loin de là ".repeat(50));

    expect(() => restaurerSauvegarde(faux, base)).toThrow();

    expect(lire(base)).toBe("actuelle");
    expect(existsSync(`${base}.avant-restauration`)).toBe(false);
  });

  // Une 2e restauration (mauvaise sauvegarde choisie d'abord, puis la bonne) écrasait le filet de sécurité :
  // les données d'avant la toute première restauration étaient perdues sans le moindre message.
  it("n'écrase jamais l'ancien filet de sécurité lors d'une deuxième restauration", () => {
    const base = creerBase("mboapilot.db", "actuelle");
    const a = creerBase("A.db", "sauvegarde-A");
    const b = creerBase("B.db", "sauvegarde-B");

    restaurerSauvegarde(a, base);
    restaurerSauvegarde(b, base);

    expect(lire(base)).toBe("sauvegarde-B");
    const conservees = readdirSync(dossier).filter((f) => f.startsWith("mboapilot.db.avant-restauration"));
    const contenus = conservees.map((f) => lire(join(dossier, f))).sort();
    expect(contenus).toEqual(["actuelle", "sauvegarde-A"]);
    // la plus récente garde le nom documenté
    expect(lire(`${base}.avant-restauration`)).toBe("sauvegarde-A");
  });
});

// Après un arrêt brutal (fenêtre fermée), les dernières écritures de la base vivent dans mboapilot.db-wal. L'ancienne base
// était mise de côté en trois morceaux : annuler la restauration « en remettant le fichier .avant-restauration sous le nom
// mboapilot.db », comme l'explique le guide, rendait une base vide ou périmée (constaté : aucun article, alors que la base
// d'origine en contenait deux).
describe("restaurerSauvegarde : l'ancienne base mise de côté est complète à elle seule", () => {
  function lireArticles(fichier: string): string[] {
    const copie = join(dossier, `lecture-${Math.random().toString(36).slice(2)}.db`);
    copyFileSync(fichier, copie);
    const lecteur = new Database(copie, { readonly: true });
    try {
      return (lecteur.prepare("select v from t order by rowid").all() as { v: string }[]).map((r) => r.v);
    } finally {
      lecteur.close();
    }
  }

  // état d'une base après un arrêt brutal : fichier .db + journal -wal + -shm, sans aucune connexion ouverte
  function creerBaseApresArretBrutal(): string {
    const origine = join(dossier, "origine");
    mkdirSync(origine);
    const vivante = new Database(join(origine, "mboapilot.db"));
    vivante.pragma("journal_mode = WAL");
    vivante.exec("create table t(v text)");
    vivante.pragma("wal_checkpoint(TRUNCATE)");
    vivante.prepare("insert into t values (?)").run("avant sauvegarde");
    vivante.prepare("insert into t values (?)").run("apres sauvegarde"); // seulement dans le journal
    const cible = join(dossier, "poste");
    mkdirSync(cible);
    for (const suffixe of ["", "-wal", "-shm"]) copyFileSync(join(origine, `mboapilot.db${suffixe}`), join(cible, `mboapilot.db${suffixe}`));
    vivante.close(); // le « crash » : on n'a copié que ce que le disque contenait pendant que la base vivait
    return join(cible, "mboapilot.db");
  }

  it("fusionne le journal avant de mettre l'ancienne base de côté : .avant-restauration seul contient tout", () => {
    const base = creerBaseApresArretBrutal();
    expect(existsSync(`${base}-wal`)).toBe(true);
    const sauvegarde = creerBase("sauvegarde.db", "sauvegarde");

    restaurerSauvegarde(sauvegarde, base);

    expect(lireArticles(base)).toEqual(["sauvegarde"]);
    expect(lireArticles(`${base}.avant-restauration`)).toEqual(["avant sauvegarde", "apres sauvegarde"]);
  });

  it("n'échoue pas quand l'ancienne base est illisible : elle est conservée telle quelle", () => {
    const base = join(dossier, "mboapilot.db");
    writeFileSync(base, "pas une base SQLite ".repeat(100));
    const sauvegarde = creerBase("sauvegarde.db", "sauvegarde");

    expect(() => restaurerSauvegarde(sauvegarde, base)).not.toThrow();

    expect(lireArticles(base)).toEqual(["sauvegarde"]);
    expect(existsSync(`${base}.avant-restauration`)).toBe(true);
  });
});


// Sous Windows, une base ouverte par le serveur ne peut pas être renommée (EBUSY). Le message brut du système ne dit pas
// quoi faire ; ailleurs le renommage réussit, d'où le test réservé à Windows.
describe.skipIf(process.platform !== "win32")("restaurerSauvegarde : serveur encore en marche", () => {
  it("explique en français qu'il faut arrêter le serveur et ne touche à rien", () => {
    const base = creerBase("mboapilot.db", "actuelle");
    const sauvegarde = creerBase("A.db", "sauvegarde-A");
    const serveur = new Database(base); // le serveur garde la base ouverte
    try {
      expect(() => restaurerSauvegarde(sauvegarde, base)).toThrow(/arrêtez.*serveur/i);
      expect(() => restaurerSauvegarde(sauvegarde, base)).not.toThrow(/EBUSY|EPERM/);
      expect(existsSync(`${base}.avant-restauration`)).toBe(false);
      expect(serveur.prepare("select v from t").get()).toEqual({ v: "actuelle" });
    } finally {
      serveur.close();
    }
    expect(lire(base)).toBe("actuelle");
  });
});
