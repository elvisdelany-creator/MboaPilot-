import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { enregistrerLogoEntreprise, resoudreTypeMimeLogo } from "./logo.service.js";

let db: Db;
let idEntreprise: number;
let dossierTemp: string;

beforeEach(() => {
  db = creerDbTest();
  idEntreprise = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get().idEntreprise;
  dossierTemp = mkdtempSync(join(tmpdir(), "mboapilot-test-logo-"));
});

afterEach(() => {
  rmSync(dossierTemp, { recursive: true, force: true });
});

// 3.2.1, 13.2 : "personnalisation par entreprise (logo...)" sur les documents commerciaux
describe("enregistrerLogoEntreprise (3.2.1, 13.2)", () => {
  it("écrit le fichier sur disque et met à jour entreprise.logoUrl", () => {
    const entreprise = enregistrerLogoEntreprise(db, dossierTemp, {
      idEntreprise,
      contenu: Buffer.from("contenu-image-factice"),
      typeMime: "image/png",
    });

    expect(entreprise.logoUrl).toBe(`entreprise-${idEntreprise}.png`);
    const fichier = join(dossierTemp, entreprise.logoUrl!);
    expect(existsSync(fichier)).toBe(true);
    expect(readFileSync(fichier).toString()).toBe("contenu-image-factice");

    const relu = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, idEntreprise)).get();
    expect(relu?.logoUrl).toBe(`entreprise-${idEntreprise}.png`);
  });

  it("remplace un logo précédemment envoyé", () => {
    enregistrerLogoEntreprise(db, dossierTemp, { idEntreprise, contenu: Buffer.from("v1"), typeMime: "image/png" });

    const entreprise = enregistrerLogoEntreprise(db, dossierTemp, { idEntreprise, contenu: Buffer.from("v2"), typeMime: "image/png" });

    expect(readFileSync(join(dossierTemp, entreprise.logoUrl!)).toString()).toBe("v2");
  });

  it("rejette un type de fichier non-image", () => {
    expect(() =>
      enregistrerLogoEntreprise(db, dossierTemp, { idEntreprise, contenu: Buffer.from("x"), typeMime: "application/pdf" })
    ).toThrow(/image/i);
  });
});

describe("resoudreTypeMimeLogo", () => {
  it("déduit le type MIME depuis l'extension du fichier stocké", () => {
    expect(resoudreTypeMimeLogo("entreprise-1.png")).toBe("image/png");
    expect(resoudreTypeMimeLogo("entreprise-1.jpg")).toBe("image/jpeg");
  });
});
