import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";
import { creerAbonne } from "../abonnes/abonne.repository.js";
import {
  compterEcransOccupes,
  construireFicheComptePartage,
  creerComptePartage,
  listerComptesPartages,
  modifierComptePartage,
  trouverComptePartage,
} from "./compte-partage.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idFamille: number;
let idFormule: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = creerUtilisateur(db, { siteId, nom: "A", prenom: "B", identifiant: "caissier1", motDePasse: "motdepasse-secret", role: "CAISSIER" }).idUser;
  idFamille = db.insert(schema.familleAbonnement).values({ libelle: "NETFLIX" }).returning().get().idFamille;
  idFormule = db.insert(schema.formule).values({ idFamille, libelle: "PREMIUM", prix: 3500, rang: 1 }).returning().get().idFormule;
});

function creerAbonnementSurCompte(idComptePartage: number, statut: "ACTIF" | "EXPIRE" | "RESILIE" = "ACTIF") {
  const idAbonne = creerAbonne(db, { siteId, nom: "Client", prenom: String(Math.random()), telephone: String(Math.floor(Math.random() * 1e9)) }).idAbonne;
  return db
    .insert(schema.abonnement)
    .values({ idAbonne, idFormule, siteId, dateDebut: "2026-01-01", dateFin: "2026-01-31", statut, creePar: userId, idComptePartage })
    .returning()
    .get();
}

describe("creerComptePartage / listerComptesPartages (5.9)", () => {
  it("crée un compte partagé et le retrouve avec 0 écran occupé", () => {
    creerComptePartage(db, { siteId, idFamille, libelle: "Compte Netflix #1", identifiant: "boutique@example.cm", motDePasse: "secret", nombreEcransMax: 4 });

    const comptes = listerComptesPartages(db, siteId);

    expect(comptes).toHaveLength(1);
    expect(comptes[0].libelle).toBe("Compte Netflix #1");
    expect(comptes[0].ecransOccupes).toBe(0);
    expect(comptes[0].nombreEcransMax).toBe(4);
  });

  it("exige un libellé et un nombre d'écrans strictement positif", () => {
    expect(() => creerComptePartage(db, { siteId, idFamille, libelle: "  ", nombreEcransMax: 4 })).toThrow(/libellé/i);
    expect(() => creerComptePartage(db, { siteId, idFamille, libelle: "Compte Netflix #1", nombreEcransMax: -3 })).toThrow(/positif/i);
    expect(() => creerComptePartage(db, { siteId, idFamille, libelle: "Compte Netflix #1", nombreEcransMax: 0 })).toThrow(/positif/i);
  });

  // 11.2 : chiffrement des données sensibles au repos — l'identifiant et le
  // mot de passe du compte partagé sont déchiffrés de façon transparente à
  // la lecture, mais jamais stockés en clair dans la base.
  it("11.2 : déchiffre l'identifiant et le mot de passe à la lecture, mais ne les stocke jamais en clair", () => {
    const compte = creerComptePartage(db, {
      siteId,
      idFamille,
      libelle: "Compte Netflix #1",
      identifiant: "boutique@example.cm",
      motDePasse: "mot-de-passe-secret",
      nombreEcransMax: 4,
    });

    const brut = db.select().from(schema.comptePartageStreaming).where(eq(schema.comptePartageStreaming.idComptePartage, compte.idComptePartage)).get();
    expect(brut?.identifiant).not.toBe("boutique@example.cm");
    expect(brut?.identifiant).not.toContain("boutique@example.cm");
    expect(brut?.motDePasse).not.toBe("mot-de-passe-secret");
    expect(brut?.motDePasse).not.toContain("mot-de-passe-secret");

    const comptes = listerComptesPartages(db, siteId);
    expect(comptes[0].identifiant).toBe("boutique@example.cm");
    expect(comptes[0].motDePasse).toBe("mot-de-passe-secret");

    const trouve = trouverComptePartage(db, compte.idComptePartage);
    expect(trouve?.identifiant).toBe("boutique@example.cm");
    expect(trouve?.motDePasse).toBe("mot-de-passe-secret");
  });

  it("11.2 : un compte sans identifiant ni mot de passe (code d'accès IPTV externe) reste utilisable", () => {
    const compte = creerComptePartage(db, { siteId, idFamille, libelle: "IPTV code externe", nombreEcransMax: 1 });

    const comptes = listerComptesPartages(db, siteId);
    expect(comptes[0].identifiant).toBeNull();
    expect(comptes[0].motDePasse).toBeNull();
    expect(trouverComptePartage(db, compte.idComptePartage)?.identifiant).toBeNull();
  });

  // 11.2, 2.6 : la sauvegarde exportée ne contient pas la clé de chiffrement
  // (data/.encryption-key) — restaurée sur une machine neuve, ses identifiants
  // deviennent illisibles. Constaté en test grandeur nature : l'erreur de
  // déchiffrement faisait échouer toute la liste des comptes et, via
  // trouverComptePartage (qui n'a besoin que de la capacité), toute vente sur
  // un compte streaming.
  it("11.2 : des identifiants illisibles (clé différente) ne bloquent ni la liste ni la lecture du compte", () => {
    const compte = creerComptePartage(db, { siteId, idFamille, libelle: "Netflix #1", identifiant: "boutique@example.cm", motDePasse: "secret", nombreEcransMax: 4 });
    const autre = creerComptePartage(db, { siteId, idFamille, libelle: "Netflix #2", identifiant: "autre@example.cm", motDePasse: "secret2", nombreEcransMax: 2 });
    const illisible = `${"00".repeat(12)}:${"00".repeat(16)}:abcd`; // format valide, non authentique
    db.update(schema.comptePartageStreaming)
      .set({ identifiant: illisible, motDePasse: illisible })
      .where(eq(schema.comptePartageStreaming.idComptePartage, compte.idComptePartage))
      .run();

    const comptes = listerComptesPartages(db, siteId);

    expect(comptes).toHaveLength(2);
    const abime = comptes.find((c) => c.idComptePartage === compte.idComptePartage)!;
    expect(abime.identifiant).toBeNull();
    expect(abime.motDePasse).toBeNull();
    expect(abime.identifiantsIllisibles).toBe(true);
    const sain = comptes.find((c) => c.idComptePartage === autre.idComptePartage)!;
    expect(sain.identifiant).toBe("autre@example.cm");
    expect(sain.identifiantsIllisibles).toBe(false);
    expect(trouverComptePartage(db, compte.idComptePartage)?.libelle).toBe("Netflix #1");
  });

  it("compte uniquement les abonnements ACTIF comme écrans occupés", () => {
    const compte = creerComptePartage(db, { siteId, idFamille, libelle: "Compte Netflix #1", nombreEcransMax: 4 });
    creerAbonnementSurCompte(compte.idComptePartage, "ACTIF");
    creerAbonnementSurCompte(compte.idComptePartage, "ACTIF");
    creerAbonnementSurCompte(compte.idComptePartage, "EXPIRE");
    creerAbonnementSurCompte(compte.idComptePartage, "RESILIE");

    expect(compterEcransOccupes(db, compte.idComptePartage)).toBe(2);
    expect(listerComptesPartages(db, siteId)[0].ecransOccupes).toBe(2);
  });
});

describe("modifierComptePartage", () => {
  it("modifie la capacité et peut désactiver le compte", () => {
    const compte = creerComptePartage(db, { siteId, idFamille, libelle: "Compte Netflix #1", nombreEcransMax: 4 });

    const modifie = modifierComptePartage(db, compte.idComptePartage, { nombreEcransMax: 5, actif: false });

    expect(modifie?.nombreEcransMax).toBe(5);
    expect(modifie?.actif).toBe(0);
  });

  it("renvoie undefined pour un compte inconnu", () => {
    expect(modifierComptePartage(db, 999999, { nombreEcransMax: 5 })).toBeUndefined();
  });

  it("rejette un nombre d'écrans nul ou négatif", () => {
    const compte = creerComptePartage(db, { siteId, idFamille, libelle: "Compte Netflix #1", nombreEcransMax: 4 });
    expect(() => modifierComptePartage(db, compte.idComptePartage, { nombreEcransMax: 0 })).toThrow(/positif/i);
    expect(() => modifierComptePartage(db, compte.idComptePartage, { nombreEcransMax: -1 })).toThrow(/positif/i);
  });

  // 5.9 : constaté en test grandeur nature — réduire la capacité en dessous
  // du nombre d'écrans déjà occupés (2/2 -> 1) était accepté sans erreur,
  // affichant ensuite "2/1 écrans" : un état que le recrutement (peutAffecterEcran)
  // est censé rendre impossible d'atteindre, contourné ici par la modification.
  it("rejette une réduction de capacité en dessous du nombre d'écrans déjà occupés", () => {
    const compte = creerComptePartage(db, { siteId, idFamille, libelle: "Compte Netflix #1", nombreEcransMax: 2 });
    creerAbonnementSurCompte(compte.idComptePartage, "ACTIF");
    creerAbonnementSurCompte(compte.idComptePartage, "ACTIF");
    expect(compterEcransOccupes(db, compte.idComptePartage)).toBe(2);

    expect(() => modifierComptePartage(db, compte.idComptePartage, { nombreEcransMax: 1 })).toThrow(/écrans déjà occupés/i);

    // une capacité non réduite en dessous de l'occupation reste autorisée
    const modifie = modifierComptePartage(db, compte.idComptePartage, { nombreEcransMax: 2 });
    expect(modifie?.nombreEcransMax).toBe(2);
  });
});

describe("construireFicheComptePartage", () => {
  it("liste les occupants actuels (écrans occupés) avec l'identité de l'abonné", () => {
    const compte = creerComptePartage(db, { siteId, idFamille, libelle: "Compte Netflix #1", nombreEcransMax: 4 });
    creerAbonnementSurCompte(compte.idComptePartage, "ACTIF");
    creerAbonnementSurCompte(compte.idComptePartage, "EXPIRE");

    const fiche = construireFicheComptePartage(db, compte.idComptePartage);

    expect(fiche?.compte.libelle).toBe("Compte Netflix #1");
    expect(fiche?.occupants).toHaveLength(2);
    expect(fiche?.occupants[0].abonne.nom).toBe("Client");
  });

  it("renvoie undefined pour un compte inconnu", () => {
    expect(construireFicheComptePartage(db, 999999)).toBeUndefined();
  });
});

// 5.9 : constaté par fuzz de types — « abc » ou un décimal passait la garde
// `<= 0` et s'enregistrait comme capacité d'écrans.
describe("nombreEcransMax invalide (5.9)", () => {
  it.each(["abc", 1.5, Number.NaN, 1e30, null, undefined])("creerComptePartage refuse la capacité %s", (nombreEcransMax) => {
    expect(() => creerComptePartage(db, { siteId, idFamille, libelle: "Netflix famille", nombreEcransMax: nombreEcransMax as never })).toThrow(/écrans/i);
    expect(listerComptesPartages(db, siteId)).toHaveLength(0);
  });

  it.each(["abc", 1.5, Number.NaN, 0])("modifierComptePartage refuse la capacité %s sans modifier le compte", (nombreEcransMax) => {
    const compte = creerComptePartage(db, { siteId, idFamille, libelle: "Netflix famille", nombreEcransMax: 4 });

    expect(() => modifierComptePartage(db, compte.idComptePartage, { nombreEcransMax: nombreEcransMax as never })).toThrow(/écrans/i);
    expect(trouverComptePartage(db, compte.idComptePartage)?.nombreEcransMax).toBe(4);
  });
});

// Constaté en test grandeur nature : un compte partagé acceptait un libellé de 100 000 caractères,
// des identifiants de 100 000 caractères, le nom d'un compte existant (le personnel ne distingue
// plus quel compte choisir au recrutement), une capacité de 1 milliard d'écrans (le contrôle
// d'occupation devenait sans effet), et « actif: "non" » était lu comme vrai.
describe("compte partagé : libellé, identifiants, capacité, activation", () => {
  const base = () => ({ siteId, idFamille, libelle: "Compte Netflix #1", nombreEcransMax: 4 });

  it("retire les espaces autour du libellé", () => {
    expect(creerComptePartage(db, { ...base(), libelle: "  Compte Netflix #1  " }).libelle).toBe("Compte Netflix #1");
  });

  it("refuse le libellé d'un compte du même site, à la casse et aux espaces près, désactivé ou non", () => {
    const existant = creerComptePartage(db, base());
    modifierComptePartage(db, existant.idComptePartage, { actif: false });

    for (const homonyme of ["Compte Netflix #1", "  compte netflix #1 ", "COMPTE  NETFLIX #1"]) {
      expect(() => creerComptePartage(db, { ...base(), libelle: homonyme }), homonyme).toThrow(/porte déjà ce libellé/i);
    }
  });

  it("autorise le même libellé dans un autre site", () => {
    const entreprise = db.select().from(schema.entreprise).get()!;
    const autreSite = db.insert(schema.site).values({ idEntreprise: entreprise.idEntreprise, nom: "Site B" }).returning().get().idSite;
    creerComptePartage(db, base());

    expect(creerComptePartage(db, { ...base(), siteId: autreSite }).libelle).toBe("Compte Netflix #1");
  });

  it("refuse à la modification un libellé déjà pris par un autre compte, mais pas son propre libellé", () => {
    const a = creerComptePartage(db, base());
    const b = creerComptePartage(db, { ...base(), libelle: "Compte Prime" });

    expect(() => modifierComptePartage(db, b.idComptePartage, { libelle: "compte netflix #1" })).toThrow(/porte déjà ce libellé/i);
    expect(modifierComptePartage(db, a.idComptePartage, { libelle: "Compte Netflix #1", nombreEcransMax: 5 })?.nombreEcransMax).toBe(5);
  });

  it.each([
    ["un libellé de plus de 100 caractères", { libelle: "L".repeat(101) }, /libellé.*100 caractères/i],
    ["un identifiant de plus de 200 caractères", { identifiant: "i".repeat(201) }, /identifiant.*200 caractères/i],
    ["un mot de passe de plus de 200 caractères", { motDePasse: "m".repeat(201) }, /mot de passe.*200 caractères/i],
    ["une capacité de plus de 100 écrans", { nombreEcransMax: 101 }, /écrans.*100/i],
  ])("refuse à la création %s", (_libelle, surcharge, message) => {
    expect(() => creerComptePartage(db, { ...base(), ...surcharge })).toThrow(message);
    expect(listerComptesPartages(db, siteId)).toHaveLength(0);
  });

  it("accepte les valeurs limites : 100 caractères de libellé, 200 de mot de passe, 100 écrans", () => {
    const compte = creerComptePartage(db, { ...base(), libelle: "L".repeat(100), motDePasse: "m".repeat(200), nombreEcransMax: 100 });

    expect(compte.motDePasse).toHaveLength(200);
  });

  it("garde les espaces d'un mot de passe : ils en font partie", () => {
    expect(creerComptePartage(db, { ...base(), motDePasse: " secret " }).motDePasse).toBe(" secret ");
  });

  it.each([
    ["un libellé de plus de 100 caractères", { libelle: "L".repeat(101) }, /libellé.*100 caractères/i],
    ["une capacité de plus de 100 écrans", { nombreEcransMax: 101 }, /écrans.*100/i],
    ["un champ actif qui n'est pas un booléen", { actif: "non" }, /actif.*vrai ou faux/i],
  ])("refuse à la modification %s, sans toucher au compte", (_libelle, surcharge, message) => {
    const compte = creerComptePartage(db, base());

    expect(() => modifierComptePartage(db, compte.idComptePartage, surcharge as never)).toThrow(message);
    expect(trouverComptePartage(db, compte.idComptePartage)).toMatchObject({ libelle: "Compte Netflix #1", nombreEcransMax: 4, actif: 1 });
  });

  it("renvoie undefined pour un compte inconnu", () => {
    expect(modifierComptePartage(db, 99999, { libelle: "X" })).toBeUndefined();
  });
});
