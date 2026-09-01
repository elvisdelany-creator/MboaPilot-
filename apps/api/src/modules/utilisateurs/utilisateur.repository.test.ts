import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerUtilisateur, trouverUtilisateurParIdentifiant } from "./utilisateur.repository.js";
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
