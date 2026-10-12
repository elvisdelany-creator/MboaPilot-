import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { enregistrerLogoEntreprise, resoudreTypeMimeLogo } from "./logo.service.js";
import { JPEG_FACTICE, PNG_FACTICE } from "../../test-utils/images.js";

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
      contenu: PNG_FACTICE,
      typeMime: "image/png",
    });

    expect(entreprise.logoUrl).toBe(`entreprise-${idEntreprise}.png`);
    const fichier = join(dossierTemp, entreprise.logoUrl!);
    expect(existsSync(fichier)).toBe(true);
    expect(readFileSync(fichier).equals(PNG_FACTICE)).toBe(true);

    const relu = db.select().from(schema.entreprise).where(eq(schema.entreprise.idEntreprise, idEntreprise)).get();
    expect(relu?.logoUrl).toBe(`entreprise-${idEntreprise}.png`);
  });

  it("remplace un logo précédemment envoyé", () => {
    const v2 = Buffer.concat([PNG_FACTICE, Buffer.from("v2")]);
    enregistrerLogoEntreprise(db, dossierTemp, { idEntreprise, contenu: PNG_FACTICE, typeMime: "image/png" });

    const entreprise = enregistrerLogoEntreprise(db, dossierTemp, { idEntreprise, contenu: v2, typeMime: "image/png" });

    expect(readFileSync(join(dossierTemp, entreprise.logoUrl!)).equals(v2)).toBe(true);
  });

  it("rejette un type de fichier non-image", () => {
    expect(() =>
      enregistrerLogoEntreprise(db, dossierTemp, { idEntreprise, contenu: Buffer.from("x"), typeMime: "application/pdf" })
    ).toThrow(/image/i);
  });
});

// 11.2 : constaté en test grandeur nature — le logo était enregistré selon le type MIME
// DÉCLARÉ par le client, sans regarder le contenu : un HTML annoncé « image/png » était
// accepté, stocké et servi comme image.
describe("enregistrerLogoEntreprise : le contenu fait foi (11.2)", () => {
  it.each([
    ["HTML", Buffer.from("<html><script>alert(1)</script></html>")],
    ["SVG avec script", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["texte quelconque", Buffer.from("contenu-image-factice")],
    ["fichier vide", Buffer.alloc(0)],
  ])("refuse un fichier %s annoncé « image/png », sans rien écrire", (_nom, contenu) => {
    expect(() => enregistrerLogoEntreprise(db, dossierTemp, { idEntreprise, contenu, typeMime: "image/png" })).toThrow(/image valide/i);
    expect(existsSync(join(dossierTemp, `entreprise-${idEntreprise}.png`))).toBe(false);
    expect(db.select().from(schema.entreprise).get()?.logoUrl).toBeNull();
  });

  it("l'extension suit le contenu réel, pas le type déclaré (un JPEG annoncé PNG devient .jpg)", () => {
    const entreprise = enregistrerLogoEntreprise(db, dossierTemp, { idEntreprise, contenu: JPEG_FACTICE, typeMime: "image/png" });
    expect(entreprise.logoUrl).toBe(`entreprise-${idEntreprise}.jpg`);
  });

  it("supprime l'ancien fichier quand le format change (png → jpg), sans laisser d'orphelin", () => {
    enregistrerLogoEntreprise(db, dossierTemp, { idEntreprise, contenu: PNG_FACTICE, typeMime: "image/png" });
    expect(existsSync(join(dossierTemp, `entreprise-${idEntreprise}.png`))).toBe(true);

    enregistrerLogoEntreprise(db, dossierTemp, { idEntreprise, contenu: JPEG_FACTICE, typeMime: "image/jpeg" });

    expect(existsSync(join(dossierTemp, `entreprise-${idEntreprise}.png`))).toBe(false);
    expect(existsSync(join(dossierTemp, `entreprise-${idEntreprise}.jpg`))).toBe(true);
  });
});

describe("resoudreTypeMimeLogo", () => {
  it("déduit le type MIME depuis l'extension du fichier stocké", () => {
    expect(resoudreTypeMimeLogo("entreprise-1.png")).toBe("image/png");
    expect(resoudreTypeMimeLogo("entreprise-1.jpg")).toBe("image/jpeg");
  });
});
