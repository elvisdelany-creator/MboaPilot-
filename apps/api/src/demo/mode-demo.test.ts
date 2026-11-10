import { describe, it, expect } from "vitest";
import { COMPTES_DEMO, ecritureBloqueeEnDemo, estModeDemo, estTeleversement } from "./mode-demo.js";

describe("estModeDemo", () => {
  it("n'est actif que si MBOAPILOT_DEMO vaut exactement 1", () => {
    expect(estModeDemo({ MBOAPILOT_DEMO: "1" })).toBe(true);
    for (const valeur of [undefined, "", "0", "true", "oui", "11"]) expect(estModeDemo({ MBOAPILOT_DEMO: valeur })).toBe(false);
  });
});

// une démo publique partage ses comptes entre tous les visiteurs : changer un mot de passe, créer ou désactiver un compte, toucher à la licence
// ou aux sauvegardes empêcherait les suivants de s'en servir (ou exposerait des fichiers) : ces écritures sont refusées par le serveur,
// pas seulement masquées dans l'interface (le Gérant accède à l'écran Administration)
describe("ecritureBloqueeEnDemo", () => {
  it.each([
    ["POST", "/api/v1/auth/mot-de-passe"],
    ["POST", "/api/v1/utilisateurs"],
    ["PATCH", "/api/v1/utilisateurs/3"],
    ["POST", "/api/v1/utilisateurs/3/mot-de-passe"],
    ["POST", "/api/v1/sites"],
    ["PATCH", "/api/v1/sites/1"],
    ["PUT", "/api/v1/licence/expiration"],
    ["POST", "/api/v1/licence/revalider"],
    ["POST", "/api/v1/sauvegarde/export"],
    ["POST", "/api/v1/installation"],
    ["PATCH", "/api/v1/entreprise"],
    ["POST", "/api/v1/entreprise/logo"],
    ["DELETE", "/api/v1/utilisateurs/3"],
    ["post", "/api/v1/utilisateurs"], // la casse de la méthode ne contourne rien
    ["POST", "/api/v1/utilisateurs?x=1"], // ni une chaîne de requête
  ])("bloque %s %s", (methode, chemin) => {
    expect(ecritureBloqueeEnDemo(methode, chemin)).toBe(true);
  });

  it.each([
    ["POST", "/api/v1/auth/login"],
    ["POST", "/api/v1/auth/renouveler"],
    ["POST", "/api/v1/ventes"],
    ["POST", "/api/v1/recrutements"],
    ["POST", "/api/v1/produits"],
    ["POST", "/api/v1/stock/achats"],
    ["POST", "/api/v1/sav/dossiers"],
    ["POST", "/api/v1/caisse/ouverture"],
    ["PATCH", "/api/v1/abonnes/1"],
  ])("laisse passer %s %s (les parcours métier à essayer)", (methode, chemin) => {
    expect(ecritureBloqueeEnDemo(methode, chemin)).toBe(false);
  });

  it("ne bloque jamais une lecture", () => {
    for (const chemin of ["/api/v1/utilisateurs", "/api/v1/sites", "/api/v1/entreprise", "/api/v1/licence/etat", "/api/v1/sauvegarde"]) {
      expect(ecritureBloqueeEnDemo("GET", chemin)).toBe(false);
      expect(ecritureBloqueeEnDemo("HEAD", chemin)).toBe(false);
    }
  });

  it("ne confond pas un préfixe voisin avec une route bloquée", () => {
    expect(ecritureBloqueeEnDemo("POST", "/api/v1/utilisateurs-autre")).toBe(false);
    expect(ecritureBloqueeEnDemo("POST", "/api/v1/sitesmaison")).toBe(false);
  });
});

describe("COMPTES_DEMO", () => {
  it("propose Gérant, Caissier et Technicien SAV, sans compte Administrateur", () => {
    expect(COMPTES_DEMO.map((c) => c.role)).toEqual(["GERANT", "CAISSIER", "TECHNICIEN_SAV"]);
    expect((COMPTES_DEMO.map((c) => c.role) as string[]).includes("ADMINISTRATEUR")).toBe(false);
  });

  it("donne à chacun un identifiant et un mot de passe distincts, assez longs pour la politique de mots de passe", () => {
    expect(new Set(COMPTES_DEMO.map((c) => c.identifiant)).size).toBe(COMPTES_DEMO.length);
    for (const c of COMPTES_DEMO) expect(c.motDePasse.length).toBeGreaterThanOrEqual(8);
  });
});

// un envoi de fichier coûte bien plus qu'un appel ordinaire (jusqu'à 1 Mo écrit sur le disque, souvent éphémère et petit, d'un hébergement
// gratuit) : sous le seul plafond général de requêtes, un script pourrait le remplir en quelques minutes
describe("estTeleversement", () => {
  it.each([
    ["POST", "/api/v1/sav/dossiers/12/photos"],
    ["POST", "/api/v1/produits/import-csv"],
    ["post", "/api/v1/produits/import-csv?x=1"],
  ])("reconnaît %s %s", (methode, chemin) => {
    expect(estTeleversement(methode, chemin)).toBe(true);
  });

  it.each([
    ["GET", "/api/v1/sav/dossiers/12/photos"],
    ["POST", "/api/v1/ventes"],
    ["POST", "/api/v1/sav/dossiers"],
    ["DELETE", "/api/v1/sav/photos/3"],
  ])("ne confond pas %s %s avec un envoi de fichier", (methode, chemin) => {
    expect(estTeleversement(methode, chemin)).toBe(false);
  });
});
