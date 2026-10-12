import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerUtilisateur, listerUtilisateurs, modifierUtilisateur, reinitialiserMotDePasse, trouverUtilisateurParIdentifiant } from "./utilisateur.repository.js";
import * as schema from "../../db/schema.js";
import { authentifier } from "../auth/auth.service.js";

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

  // 11.2, 8.8 : "politique de complexité minimale configurable"
  it("rejette un mot de passe plus court que la politique par défaut (8 caractères)", () => {
    expect(() =>
      creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "court1", role: "CAISSIER" })
    ).toThrow(/8 caractères/);
  });

  it("applique une politique personnalisée configurée sur le site", () => {
    db.update(schema.entreprise).set({ politiqueMdpExigerMajuscule: 1, politiqueMdpExigerChiffre: 1 }).run();

    expect(() =>
      creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "minusculesansaucunchiffre", role: "CAISSIER" })
    ).toThrow(/majuscule/);

    const u = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga2", motDePasse: "Motdepasse1", role: "CAISSIER" });
    expect(u.identifiant).toBe("vnga2");
  });

  it("exige un nom, un prénom et un identifiant", () => {
    expect(() =>
      creerUtilisateur(db, { siteId, nom: "  ", prenom: "Valentin", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" })
    ).toThrow(/nom/i);
    expect(() =>
      creerUtilisateur(db, { siteId, nom: "Nga", prenom: " ", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" })
    ).toThrow(/prénom/i);
    expect(() =>
      creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "  ", motDePasse: "motdepasse-secret", role: "CAISSIER" })
    ).toThrow(/identifiant/i);
  });

  // 2.5.1 : le type Role n'existe qu'à la compilation — constaté en test
  // grandeur nature : un rôle inexistant envoyé par l'API (« SUPERADMIN ») était
  // enregistré tel quel, produisant un compte qui n'est accepté par aucun garde
  it("rejette un rôle qui n'existe pas", () => {
    expect(() =>
      creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "SUPERADMIN" as never })
    ).toThrow(/rôle/i);
  });

  it("rejette un identifiant déjà utilisé avec un message clair, pas une erreur SQL brute", () => {
    creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" });

    expect(() =>
      creerUtilisateur(db, { siteId, nom: "Mballa", prenom: "Sylvie", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" })
    ).toThrow(/identifiant.*déjà/i);
  });

  // 11.5 : "création d'utilisateur" — action sensible à journaliser, avec l'auteur
  it("journalise la création d'un compte, avec l'auteur, mais jamais le mot de passe", () => {
    const admin = creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });

    const u = creerUtilisateur(
      db,
      { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" },
      admin.idUser
    );

    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "utilisateur")).all().find((a) => a.idCible === String(u.idUser));
    expect(audit).toBeDefined();
    expect(audit?.action).toBe("CREATION");
    expect(audit?.utilisateurId).toBe(admin.idUser);
    expect(audit?.valeurApres).not.toMatch(/motdepasse-secret/);
    expect(JSON.parse(audit!.valeurApres!)).toMatchObject({ identifiant: "vnga", role: "CAISSIER" });
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

  it("rejette un changement vers un rôle qui n'existe pas, sans modifier le compte", () => {
    const u = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" });

    expect(() => modifierUtilisateur(db, u.idUser, { role: "NIMPORTEQUOI" as never })).toThrow(/rôle/i);
    expect(listerUtilisateurs(db, siteId)[0].role).toBe("CAISSIER");
  });

  // 11.5 : "création/désactivation d'utilisateur" — action sensible à journaliser
  it("journalise la désactivation et le changement de rôle, avec la valeur avant/après et l'auteur", () => {
    const admin = creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const u = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" });

    modifierUtilisateur(db, u.idUser, { actif: false, role: "GERANT" }, admin.idUser);

    const audits = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "utilisateur")).all();
    const audit = audits.find((a) => a.idCible === String(u.idUser) && a.action === "MODIFICATION");
    expect(audit).toBeDefined();
    expect(audit?.action).toBe("MODIFICATION");
    expect(audit?.utilisateurId).toBe(admin.idUser);
    expect(JSON.parse(audit!.valeurAvant!)).toMatchObject({ actif: 1, role: "CAISSIER" });
    expect(JSON.parse(audit!.valeurApres!)).toMatchObject({ actif: 0, role: "GERANT" });
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

// 8.7, 11.2 : aucun moyen n'existait de changer le mot de passe d'un compte
// après sa création — un mot de passe oublié imposait de désactiver le
// compte et d'en recréer un nouveau, fragmentant l'historique de l'employé
// (factures, mouvements de stock… tous rattachés à utilisateur_id)
describe("reinitialiserMotDePasse (8.7, 11.2)", () => {
  it("remplace le hash du mot de passe — l'ancien mot de passe ne fonctionne plus, le nouveau oui", () => {
    const u = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "ancien-motdepasse", role: "CAISSIER" });

    const modifie = reinitialiserMotDePasse(db, u.idUser, "nouveau-motdepasse");

    const enBase = trouverUtilisateurParIdentifiant(db, "vnga");
    expect(bcrypt.compareSync("ancien-motdepasse", enBase!.motDePasseHash)).toBe(false);
    expect(bcrypt.compareSync("nouveau-motdepasse", enBase!.motDePasseHash)).toBe(true);
    expect(modifie).not.toHaveProperty("motDePasseHash");
  });

  // 11.2, 8.8 : la même politique de complexité que pour la création s'applique
  it("applique la politique de complexité du site — rejette un mot de passe trop court", () => {
    const u = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "ancien-motdepasse", role: "CAISSIER" });

    expect(() => reinitialiserMotDePasse(db, u.idUser, "court1")).toThrow(/8 caractères/);

    const enBase = trouverUtilisateurParIdentifiant(db, "vnga");
    expect(bcrypt.compareSync("ancien-motdepasse", enBase!.motDePasseHash)).toBe(true);
  });

  // 11.5 : action sensible à journaliser, mais jamais la valeur du mot de passe (11.2)
  it("journalise la réinitialisation avec l'auteur, jamais le mot de passe", () => {
    const admin = creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const u = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "ancien-motdepasse", role: "CAISSIER" });

    reinitialiserMotDePasse(db, u.idUser, "nouveau-motdepasse", admin.idUser);

    const audits = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "utilisateur")).all();
    const audit = audits.find((a) => a.idCible === String(u.idUser) && a.action === "MODIFICATION" && a.valeurAvant === null);
    expect(audit).toBeDefined();
    expect(audit?.utilisateurId).toBe(admin.idUser);
    expect(JSON.stringify(audit)).not.toMatch(/nouveau-motdepasse|ancien-motdepasse/);
  });

  it("renvoie undefined pour un utilisateur inconnu", () => {
    expect(reinitialiserMotDePasse(db, 999999, "nouveau-motdepasse")).toBeUndefined();
  });
});

// 8.7, 11.2 : constaté à la relecture de la procédure de dépannage — réinitialiser le mot de
// passe d'un utilisateur verrouillé (5 échecs) ne le débloquait pas : il restait bloqué jusqu'à
// 15 minutes (« Réessayez dans quelques minutes ») malgré le nouveau mot de passe.
describe("reinitialiserMotDePasse : déblocage du compte (11.2)", () => {
  it("lève le verrouillage et remet le compteur d'échecs à zéro, pour pouvoir se connecter aussitôt", () => {
    const u = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "V", identifiant: "vnga", motDePasse: "ancien-motdepasse", role: "CAISSIER" });
    db.update(schema.utilisateur)
      .set({ tentativesEchouees: 3, verrouilleJusqua: new Date(Date.now() + 15 * 60_000).toISOString() })
      .where(eq(schema.utilisateur.idUser, u.idUser))
      .run();

    reinitialiserMotDePasse(db, u.idUser, "nouveau-motdepasse");

    const apres = db.select().from(schema.utilisateur).where(eq(schema.utilisateur.idUser, u.idUser)).get()!;
    expect(apres.verrouilleJusqua).toBeNull();
    expect(apres.tentativesEchouees).toBe(0);
    expect(authentifier(db, "vnga", "nouveau-motdepasse").identifiant).toBe("vnga");
  });

  it("ne débloque rien quand la réinitialisation est refusée (mot de passe trop court)", () => {
    const u = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "V", identifiant: "vnga", motDePasse: "ancien-motdepasse", role: "CAISSIER" });
    const verrou = new Date(Date.now() + 15 * 60_000).toISOString();
    db.update(schema.utilisateur).set({ tentativesEchouees: 3, verrouilleJusqua: verrou }).where(eq(schema.utilisateur.idUser, u.idUser)).run();

    expect(() => reinitialiserMotDePasse(db, u.idUser, "court1")).toThrow();

    const apres = db.select().from(schema.utilisateur).where(eq(schema.utilisateur.idUser, u.idUser)).get()!;
    expect(apres.verrouilleJusqua).toBe(verrou);
  });
});

// Constaté en test grandeur nature : l'API acceptait « ADMIN », « Admin », « admin » entouré
// d'espaces, un « а » cyrillique (identique à l'œil), des tabulations, 300 caractères ou « ; ».
// Deux comptes à l'identifiant visuellement identique permettent l'usurpation (un caissier
// nommé « Admin ») et rendent la connexion ambiguë : l'identifiant doit être normalisé.
describe("identifiant de connexion : forme et unicité", () => {
  const base = { nom: "Nga", prenom: "Valentin", motDePasse: "motdepasse-secret", role: "CAISSIER" as const };

  it("retire les espaces autour et enregistre l'identifiant en minuscules", () => {
    const u = creerUtilisateur(db, { siteId, ...base, identifiant: "  VNga  " });

    expect(u.identifiant).toBe("vnga");
  });

  it("refuse un identifiant qui ne diffère d'un compte existant que par la casse ou les espaces", () => {
    creerUtilisateur(db, { siteId, ...base, identifiant: "admin" });

    for (const variante of ["ADMIN", "Admin", "  admin  "]) {
      expect(() => creerUtilisateur(db, { siteId, ...base, identifiant: variante }), variante).toThrow(/identifiant.*déjà/i);
    }
  });

  it.each([
    ["un caractère cyrillique imitant une lettre latine", "аdmin"],
    ["un espace au milieu", "zz ident"],
    ["une tabulation", "zz\tident"],
    ["un espace de largeur nulle", "admin\u200b"],
    ["un point-virgule", "zz;drop"],
    ["moins de 3 caractères", "ab"],
    ["plus de 50 caractères", "x".repeat(51)],
  ])("refuse un identifiant contenant %s", (_libelle, identifiant) => {
    expect(() => creerUtilisateur(db, { siteId, ...base, identifiant })).toThrow(/identifiant/i);
  });

  it.each(["vnga", "v.nga", "v_nga-2", "valentin@boutique.cm", "caissier01"])("accepte l'identifiant « %s »", (identifiant) => {
    expect(creerUtilisateur(db, { siteId, ...base, identifiant }).identifiant).toBe(identifiant);
  });

  it("retrouve un compte quelle que soit la casse ou les espaces saisis à la connexion", () => {
    creerUtilisateur(db, { siteId, ...base, identifiant: "vnga" });

    expect(trouverUtilisateurParIdentifiant(db, "VNGA")?.identifiant).toBe("vnga");
    expect(trouverUtilisateurParIdentifiant(db, "  vnga ")?.identifiant).toBe("vnga");
    expect(authentifier(db, " VNga ", "motdepasse-secret").identifiant).toBe("vnga");
  });

  it("retrouve un ancien compte enregistré avec des majuscules avant cette règle", () => {
    db.insert(schema.utilisateur)
      .values({ siteId, nom: "Ancien", prenom: "Compte", identifiant: "Ancien.Compte", motDePasseHash: bcrypt.hashSync("motdepasse-secret", 4), role: "CAISSIER" })
      .run();

    expect(trouverUtilisateurParIdentifiant(db, "ancien.compte")?.identifiant).toBe("Ancien.Compte");
    expect(() => creerUtilisateur(db, { siteId, ...base, identifiant: "ANCIEN.compte" })).toThrow(/identifiant.*déjà/i);
  });
});
