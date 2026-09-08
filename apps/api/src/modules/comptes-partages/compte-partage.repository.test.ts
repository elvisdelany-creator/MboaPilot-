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
