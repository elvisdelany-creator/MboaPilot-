import { afterEach, describe, expect, it } from "vitest";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { cheminBase, cheminCleChiffrement, cheminSecretJwt, dossierDonnees, dossierLogos, dossierPhotosSav, dossierSauvegardes } from "./chemins.js";

// 2.2, 2.6 : constaté en test grandeur nature — base, secret JWT, clé de chiffrement,
// sauvegardes, photos et logos étaient cherchés dans « ./data », relatif au dossier de
// LANCEMENT : démarré depuis un autre dossier, le serveur plantait (« Cannot open
// database because the directory does not exist ») ou, si un dossier data y existait,
// repartait en silence sur une base neuve et vide, avec un autre secret et une autre
// clé de chiffrement (identifiants de comptes streaming illisibles).
const dossierInitial = process.cwd();
afterEach(() => process.chdir(dossierInitial));

describe("chemins des données (2.2)", () => {
  it("par défaut : dossier data de l'API, chemin absolu", () => {
    const dossier = dossierDonnees({});
    expect(isAbsolute(dossier)).toBe(true);
    expect(dossier.replaceAll("\\", "/")).toMatch(/apps\/api\/data$/);
  });

  it("ne dépend pas du dossier de lancement", () => {
    const avant = { base: cheminBase({}), jwt: cheminSecretJwt({}), cle: cheminCleChiffrement({}), sauvegardes: dossierSauvegardes({}), photos: dossierPhotosSav({}), logos: dossierLogos({}) };

    process.chdir(tmpdir());

    expect({ base: cheminBase({}), jwt: cheminSecretJwt({}), cle: cheminCleChiffrement({}), sauvegardes: dossierSauvegardes({}), photos: dossierPhotosSav({}), logos: dossierLogos({}) }).toEqual(avant);
  });

  it("tous les chemins par défaut sont sous le dossier de données", () => {
    const racine = dossierDonnees({});
    expect(cheminBase({})).toBe(join(racine, "mboapilot.db"));
    expect(cheminSecretJwt({})).toBe(join(racine, ".jwt-secret"));
    expect(cheminCleChiffrement({})).toBe(join(racine, ".encryption-key"));
    expect(dossierSauvegardes({})).toBe(join(racine, "backups"));
    expect(dossierPhotosSav({})).toBe(join(racine, "sav-photos"));
    expect(dossierLogos({})).toBe(join(racine, "logos"));
  });

  it("MBOAPILOT_DATA_DIR déplace tout le dossier de données", () => {
    const racine = join(tmpdir(), "mboapilot-donnees-test");
    const env = { MBOAPILOT_DATA_DIR: racine };
    expect(dossierDonnees(env)).toBe(racine);
    expect(cheminBase(env)).toBe(join(racine, "mboapilot.db"));
    expect(dossierSauvegardes(env)).toBe(join(racine, "backups"));
  });

  it("les variables historiques restent prioritaires (MBOAPILOT_DB_PATH, MBOAPILOT_BACKUPS_DIR)", () => {
    expect(cheminBase({ MBOAPILOT_DB_PATH: "/autre/base.db" })).toBe("/autre/base.db");
    expect(dossierSauvegardes({ MBOAPILOT_BACKUPS_DIR: "/autre/sauvegardes" })).toBe("/autre/sauvegardes");
  });
});
