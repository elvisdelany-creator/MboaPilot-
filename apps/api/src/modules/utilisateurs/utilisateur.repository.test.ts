import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerUtilisateur, listerUtilisateurs, modifierUtilisateur, trouverUtilisateurParIdentifiant } from "./utilisateur.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
});

describe("creerUtilisateur (2.5.1)", () => {
  it("hache le mot de passe — jamais stocké en clair (11.2)", () => {
    const u = creerUtilisateur(db, {
      siteId,
      nom: "Nga Ndongo",
      prenom: "Valentin",
      identifiant: "vnga",
      motDePasse: "motdepasse-secret",
      role: "CAISSIER",
    });

    expect(u.motDePasseHash).not.toBe("motdepasse-secret");
    expect(u.motDePasseHash.length).toBeGreaterThan(20);
  });
});

describe("trouverUtilisateurParIdentifiant", () => {
  it("retrouve un utilisateur actif par son identifiant", () => {
    creerUtilisateur(db, {
      siteId,
      nom: "Nga Ndongo",
      prenom: "Valentin",
      identifiant: "vnga",
      motDePasse: "motdepasse-secret",
      role: "CAISSIER",
    });

    const trouve = trouverUtilisateurParIdentifiant(db, "vnga");

    expect(trouve?.identifiant).toBe("vnga");
  });

  it("renvoie undefined si l'identifiant n'existe pas", () => {
    expect(trouverUtilisateurParIdentifiant(db, "inconnu")).toBeUndefined();
  });
});

describe("listerUtilisateurs (8.7)", () => {
  it("liste les utilisateurs du site, actifs et inactifs, sans le hash du mot de passe", () => {
    creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" });
    const autreSite = db.insert(schema.site).values({ idEntreprise: 1, nom: "Site B" }).returning().get().idSite;
    creerUtilisateur(db, { siteId: autreSite, nom: "Autre", prenom: "Site", identifiant: "autre", motDePasse: "motdepasse-secret", role: "CAISSIER" });

    const liste = listerUtilisateurs(db, siteId);

    expect(liste).toHaveLength(1);
    expect(liste[0].identifiant).toBe("vnga");
    expect(liste[0]).not.toHaveProperty("motDePasseHash");
  });
});

describe("modifierUtilisateur (8.7)", () => {
  it("désactive un compte et change son rôle", () => {
    const u = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" });

    const modifie = modifierUtilisateur(db, u.idUser, { actif: false, role: "GERANT" });

    expect(modifie?.actif).toBe(0);
    expect(modifie?.role).toBe("GERANT");
  });

  it("un compte désactivé ne peut plus se connecter", () => {
    const u = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" });
    modifierUtilisateur(db, u.idUser, { actif: false });

    const trouve = trouverUtilisateurParIdentifiant(db, "vnga");

    expect(trouve?.actif).toBe(0);
  });

  it("renvoie undefined pour un utilisateur inconnu", () => {
    expect(modifierUtilisateur(db, 999999, { actif: false })).toBeUndefined();
  });
});
