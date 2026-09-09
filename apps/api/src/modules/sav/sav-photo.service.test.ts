import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { creerDossierSav } from "./sav.repository.js";
import { enregistrerPhotoSav, listerPhotosSav } from "./sav-photo.service.js";

let db: Db;
let dossireTemp: string;
let dossierPhotos: string;
let siteId: number;
let userId: number;
let idDossierSav: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "TECHNICIEN_SAV" })
    .returning()
    .get().idUser;
  idDossierSav = creerDossierSav(db, { siteId, descriptionPanne: "Ne s'allume plus", sousGarantie: false, userId }).idDossierSav;

  dossireTemp = mkdtempSync(join(tmpdir(), "mboapilot-test-sav-photos-"));
  dossierPhotos = join(dossireTemp, "sav-photos");
});

afterEach(() => {
  rmSync(dossireTemp, { recursive: true, force: true });
});

describe("enregistrerPhotoSav (5.10 : photos optionnelles du dossier SAV)", () => {
  it("écrit le fichier sur disque et journalise ses métadonnées", () => {
    const contenu = Buffer.from("contenu-image-factice");

    const photo = enregistrerPhotoSav(db, dossierPhotos, {
      idDossierSav,
      contenu,
      nomFichierOriginal: "avant-reparation.jpg",
      typeMime: "image/jpeg",
    });

    expect(photo.nomFichierOriginal).toBe("avant-reparation.jpg");
    expect(photo.typeMime).toBe("image/jpeg");
    expect(readFileSync(join(dossierPhotos, photo.nomFichier))).toEqual(contenu);
  });

  it("crée le dossier de stockage s'il n'existe pas encore", () => {
    expect(existsSync(dossierPhotos)).toBe(false);
    enregistrerPhotoSav(db, dossierPhotos, { idDossierSav, contenu: Buffer.from("x"), nomFichierOriginal: "photo.png", typeMime: "image/png" });
    expect(existsSync(dossierPhotos)).toBe(true);
  });

  it("génère un nom de fichier unique et non devinable, distinct du nom original", () => {
    const p1 = enregistrerPhotoSav(db, dossierPhotos, { idDossierSav, contenu: Buffer.from("a"), nomFichierOriginal: "photo.jpg", typeMime: "image/jpeg" });
    const p2 = enregistrerPhotoSav(db, dossierPhotos, { idDossierSav, contenu: Buffer.from("b"), nomFichierOriginal: "photo.jpg", typeMime: "image/jpeg" });

    expect(p1.nomFichier).not.toBe(p2.nomFichier);
    expect(p1.nomFichier).not.toBe("photo.jpg");
  });

  it("rejette un type de fichier non image", () => {
    expect(() =>
      enregistrerPhotoSav(db, dossierPhotos, { idDossierSav, contenu: Buffer.from("x"), nomFichierOriginal: "malware.exe", typeMime: "application/x-msdownload" })
    ).toThrow(/image/i);
  });
});

describe("listerPhotosSav (5.10)", () => {
  it("liste les photos d'un dossier, la plus récente en dernier, sans mélanger avec un autre dossier", () => {
    const autreDossier = creerDossierSav(db, { siteId, descriptionPanne: "Autre panne", sousGarantie: false, userId }).idDossierSav;
    enregistrerPhotoSav(db, dossierPhotos, { idDossierSav, contenu: Buffer.from("a"), nomFichierOriginal: "1.jpg", typeMime: "image/jpeg" });
    enregistrerPhotoSav(db, dossierPhotos, { idDossierSav, contenu: Buffer.from("b"), nomFichierOriginal: "2.jpg", typeMime: "image/jpeg" });
    enregistrerPhotoSav(db, dossierPhotos, { idDossierSav: autreDossier, contenu: Buffer.from("c"), nomFichierOriginal: "3.jpg", typeMime: "image/jpeg" });

    const photos = listerPhotosSav(db, idDossierSav);

    expect(photos).toHaveLength(2);
    expect(photos.map((p) => p.nomFichierOriginal)).toEqual(["1.jpg", "2.jpg"]);
  });

  it("renvoie un tableau vide pour un dossier sans photo", () => {
    expect(listerPhotosSav(db, idDossierSav)).toEqual([]);
  });
});
