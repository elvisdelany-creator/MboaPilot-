import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import type * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { restaurerSauvegarde } from "./restaurer-sauvegarde.service.js";

vi.mock("node:fs", async (importerOriginal) => {
  const reel = await importerOriginal<typeof fs>();
  return { ...reel, copyFileSync: vi.fn(reel.copyFileSync) };
});

// Test grandeur nature « reprise sur panne » : la copie de la sauvegarde est la partie longue d'une restauration. Une coupure pendant qu'elle
// avait lieu laissait la boutique sans base, ou avec une base à moitié copiée. La base en place ne doit pas bouger tant que la copie dure.
let dossier: string;

function creerBase(nom: string, valeur: string): string {
  const chemin = join(dossier, nom);
  const base = new Database(chemin);
  base.exec("create table entreprise(id integer); create table utilisateur(id integer); create table t(v text)");
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

describe("restaurerSauvegarde : pendant la copie, la base en place ne bouge pas", () => {
  it("la base actuelle est encore là, intacte, au moment où la sauvegarde est copiée", async () => {
    const reel = await vi.importActual<typeof fs>("node:fs");
    const base = creerBase("mboapilot.db", "actuelle");
    const sauvegarde = creerBase("A.db", "sauvegarde-A");
    let pendantLaCopie = "";
    vi.mocked(copyFileSync).mockImplementationOnce((source, destination) => {
      pendantLaCopie = existsSync(base) ? lire(base) : "plus de base";
      reel.copyFileSync(source, destination);
    });

    restaurerSauvegarde(sauvegarde, base);

    expect(pendantLaCopie).toBe("actuelle");
    expect(lire(base)).toBe("sauvegarde-A");
  });

  it("une copie en échec (disque plein) ne laisse ni changement ni reste", () => {
    const base = creerBase("mboapilot.db", "actuelle");
    const sauvegarde = creerBase("A.db", "sauvegarde-A");
    vi.mocked(copyFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    });

    expect(() => restaurerSauvegarde(sauvegarde, base)).toThrow(/ENOSPC/);

    expect(lire(base)).toBe("actuelle");
    expect(existsSync(`${base}.avant-restauration`)).toBe(false);
    expect(existsSync(`${base}.restauration-en-cours`)).toBe(false);
  });
});
