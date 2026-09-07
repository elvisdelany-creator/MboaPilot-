import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creerDbTest, type Db } from "./test-utils/db.js";
import { buildApp } from "./app.js";
import { creerUtilisateur } from "./modules/utilisateurs/utilisateur.repository.js";
import * as schema from "./db/schema.js";

const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";

let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = creerUtilisateur(db, {
    siteId,
    nom: "A",
    prenom: "B",
    identifiant: "caissier1",
    motDePasse: "motdepasse-secret",
    role: "CAISSIER",
  }).idUser;
  const fam = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get();
  idFormule = db
    .insert(schema.formule)
    .values({ idFamille: fam.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 })
    .returning()
    .get().idFormule;
});

async function connecter(app: FastifyInstance, identifiant = "caissier1", motDePasse = "motdepasse-secret") {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse } });
  return reponse.json().token as string;
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("POST /api/v1/auth/login (2.5.1)", () => {
  it("renvoie un jeton et le profil utilisateur (sans le hash) pour des identifiants valides", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { identifiant: "caissier1", motDePasse: "motdepasse-secret" },
    });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json();
    expect(corps.token).toBeTypeOf("string");
    expect(corps.utilisateur.identifiant).toBe("caissier1");
    expect(corps.utilisateur).not.toHaveProperty("motDePasseHash");
  });

  it("renvoie 401 pour un mot de passe incorrect", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { identifiant: "caissier1", motDePasse: "faux" },
    });

    expect(reponse.statusCode).toBe(401);
  });

  it("11.2 : verrouille le compte après 5 mots de passe incorrects, avec un message dédié", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "caissier1", motDePasse: "faux" } });
    }

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { identifiant: "caissier1", motDePasse: "motdepasse-secret" },
    });

    expect(reponse.statusCode).toBe(401);
    expect(reponse.json().erreur).toMatch(/verrouill/i);
  });
});

describe("Garde d'authentification (11.2 : RBAC de bout en bout, jamais uniquement côté interface)", () => {
  it("rejette une route métier sans jeton (401)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({ method: "GET", url: "/api/v1/catalogue" });

    expect(reponse.statusCode).toBe(401);
  });

  it("rejette un jeton invalide (401)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({
      method: "GET",
      url: "/api/v1/catalogue",
      headers: authHeader("jeton.invalide.forge"),
    });

    expect(reponse.statusCode).toBe(401);
  });

  it("rejette un rôle non autorisé sur une route de vente (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, {
      siteId,
      nom: "Tech",
      prenom: "SAV",
      identifiant: "sav1",
      motDePasse: "motdepasse-secret",
      role: "TECHNICIEN_SAV",
    });
    const token = await connecter(app, "sav1");

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });

    expect(reponse.statusCode).toBe(403);
  });
});

describe("POST /api/v1/recrutements", () => {
  it("crée un abonnement et renvoie 201", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });

    expect(reponse.statusCode).toBe(201);
    const corps = reponse.json();
    expect(corps.statutFacture).toBe("VALIDEE");
    expect(corps.numeroAbonnement).toBeTypeOf("number");
  });

  it("renvoie 404 si la formule n'existe pas", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "X", prenom: "Y", telephone: "600000000" },
        idFormule: 999999,
        montantEncaisse: 1000,
      },
    });

    expect(reponse.statusCode).toBe(404);
  });
});

describe("POST /api/v1/abonnements/:numeroAbonnement/reabonnements", () => {
  it("réabonne et renvoie 200", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });
    const { numeroAbonnement } = creation.json();

    const reponse = await app.inject({
      method: "POST",
      url: `/api/v1/abonnements/${numeroAbonnement}/reabonnements`,
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui: "2025-12-20", montantEncaisse: 13000 },
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().statutFacture).toBe("VALIDEE");
  });

  it("renvoie 404 pour un numéro d'abonnement inconnu", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/abonnements/999999/reabonnements",
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui: "2025-12-20", montantEncaisse: 1000 },
    });

    expect(reponse.statusCode).toBe(404);
  });
});

describe("GET /api/v1/abonnes/:idAbonne/abonnements", () => {
  it("renvoie les abonnements de l'abonné, pour la détection recrutement vs réabonnement (9.2)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });
    const { numeroAbonnement } = creation.json();
    const abonnes = await app.inject({
      method: "GET",
      url: `/api/v1/abonnes?siteId=${siteId}&q=Ndongo`,
      headers: authHeader(token),
    });
    const idAbonne = abonnes.json()[0].idAbonne;

    const reponse = await app.inject({
      method: "GET",
      url: `/api/v1/abonnes/${idAbonne}/abonnements`,
      headers: authHeader(token),
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toEqual([expect.objectContaining({ numeroAbonnement })]);
  });
});

describe("GET /api/v1/catalogue", () => {
  it("renvoie les familles avec leurs formules", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: authHeader(token) });

    expect(reponse.statusCode).toBe(200);
    const catalogue = reponse.json();
    expect(catalogue.some((f: { libelle: string }) => f.libelle === "DSTV")).toBe(true);
  });
});

describe("GET /api/v1/abonnes", () => {
  it("recherche unifiée par nom, cloisonnée par site", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });

    const reponse = await app.inject({
      method: "GET",
      url: `/api/v1/abonnes?siteId=${siteId}&q=Ndongo`,
      headers: authHeader(token),
    });

    expect(reponse.statusCode).toBe(200);
    const resultats = reponse.json();
    expect(resultats).toHaveLength(1);
    expect(resultats[0].nom).toBe("Nga Ndongo");
  });
});

describe("POST /api/v1/jobs/quotidien (4.3, 4.4, 6.2)", () => {
  it("réservé à l'administrateur : 403 pour un caissier", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({ method: "POST", url: "/api/v1/jobs/quotidien", headers: authHeader(token) });

    expect(reponse.statusCode).toBe(403);
  });

  it("exécute le job et renvoie le récapitulatif pour un administrateur", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, {
      siteId,
      nom: "Admin",
      prenom: "Démo",
      identifiant: "admin1",
      motDePasse: "motdepasse-secret",
      role: "ADMINISTRATEUR",
    });
    const token = await connecter(app, "admin1");

    const reponse = await app.inject({ method: "POST", url: "/api/v1/jobs/quotidien", headers: authHeader(token) });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toEqual(
      expect.objectContaining({ abonnementsExpires: expect.any(Number), alertesCreees: expect.any(Number) })
    );
  });
});

describe("GET /api/v1/alertes-echeance", () => {
  it("renvoie la liste des alertes déclenchées pour le site", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-10-01",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });
    expect(creation.statusCode).toBe(201);

    await app.inject({ method: "POST", url: "/api/v1/jobs/quotidien", headers: authHeader(token) });

    const reponse = await app.inject({ method: "GET", url: `/api/v1/alertes-echeance?siteId=${siteId}`, headers: authHeader(token) });

    expect(reponse.statusCode).toBe(200);
    expect(Array.isArray(reponse.json())).toBe(true);
  });
});

describe("POST /api/v1/abonnements/:numeroAbonnement/echange-materiel (7.3)", () => {
  it("échange le matériel et renvoie 201", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
        idFormule,
        montantEncaisse: 13000,
      },
    });
    const { numeroAbonnement } = creation.json();
    const produit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000 }).returning().get();

    const reponse = await app.inject({
      method: "POST",
      url: `/api/v1/abonnements/${numeroAbonnement}/echange-materiel`,
      headers: authHeader(token),
      payload: { siteId, userId, idProduit: produit.idProduit, typeMateriel: "DECODEUR", sousGarantie: true, motif: "panne", montantEncaisse: 0 },
    });

    expect(reponse.statusCode).toBe(201);
    expect(reponse.json()).toEqual(expect.objectContaining({ montantFacture: 0, statutFacture: "VALIDEE" }));
  });

  it("renvoie 404 pour un numéro d'abonnement inconnu", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const produit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000 }).returning().get();

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/abonnements/999999/echange-materiel",
      headers: authHeader(token),
      payload: { siteId, userId, idProduit: produit.idProduit, typeMateriel: "DECODEUR", sousGarantie: true, motif: "panne", montantEncaisse: 0 },
    });

    expect(reponse.statusCode).toBe(404);
  });
});

describe("Module SAV (5.10, 8.4)", () => {
  it("cycle complet : ouverture, pièce, réparation, mise à disposition, restitution", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const ouverture = await app.inject({
      method: "POST",
      url: "/api/v1/sav/dossiers",
      headers: authHeader(token),
      payload: { siteId, descriptionPanne: "Ne s'allume plus", sousGarantie: false, userId },
    });
    expect(ouverture.statusCode).toBe(201);
    const { idDossierSav } = ouverture.json();

    const produit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Alimentation", prixVente: 3000 }).returning().get();

    const piece = await app.inject({
      method: "POST",
      url: `/api/v1/sav/dossiers/${idDossierSav}/pieces`,
      headers: authHeader(token),
      payload: { idProduit: produit.idProduit, quantite: 1, userId },
    });
    expect(piece.statusCode).toBe(201);

    await app.inject({
      method: "POST",
      url: `/api/v1/sav/dossiers/${idDossierSav}/statut`,
      headers: authHeader(token),
      payload: { nouveauStatut: "DIAGNOSTIC", userId },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/sav/dossiers/${idDossierSav}/statut`,
      headers: authHeader(token),
      payload: { nouveauStatut: "REPARATION", userId },
    });
    const pret = await app.inject({
      method: "POST",
      url: `/api/v1/sav/dossiers/${idDossierSav}/statut`,
      headers: authHeader(token),
      payload: { nouveauStatut: "PRET", montantMainOeuvre: 1000, userId },
    });
    expect(pret.statusCode).toBe(200);
    expect(pret.json()).toEqual(expect.objectContaining({ montantFacture: 4000, statutFacture: "BROUILLON" }));

    const livre = await app.inject({
      method: "POST",
      url: `/api/v1/sav/dossiers/${idDossierSav}/statut`,
      headers: authHeader(token),
      payload: { nouveauStatut: "LIVRE", montantEncaisse: 4000, userId },
    });
    expect(livre.statusCode).toBe(200);
    expect(livre.json().statutFacture).toBe("VALIDEE");

    const detail = await app.inject({ method: "GET", url: `/api/v1/sav/dossiers/${idDossierSav}`, headers: authHeader(token) });
    expect(detail.statusCode).toBe(200);
    const corps = detail.json();
    expect(corps.statut).toBe("LIVRE");
    expect(corps.pieces).toHaveLength(1);
    expect(corps.historique.length).toBeGreaterThanOrEqual(5);
    expect(corps.facture).toEqual(expect.objectContaining({ statut: "VALIDEE", montantTotal: 4000 }));
  });

  it("rejette un rôle non habilité (Comptable)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "C", prenom: "D", identifiant: "compta1", motDePasse: "motdepasse-secret", role: "COMPTABLE" });
    const token = await connecter(app, "compta1");

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/sav/dossiers",
      headers: authHeader(token),
      payload: { siteId, descriptionPanne: "Panne", sousGarantie: false, userId },
    });

    expect(reponse.statusCode).toBe(403);
  });
});

describe("Module apporteur d'affaires (6.3)", () => {
  it("un administrateur crée un apporteur, un caissier peut le lister (choix au recrutement)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/apporteurs",
      headers: authHeader(tokenAdmin),
      payload: { nom: "Jean Apporteur", tauxCommissionDefaut: 500 },
    });
    expect(creation.statusCode).toBe(201);

    const tokenCaissier = await connecter(app);
    const liste = await app.inject({ method: "GET", url: "/api/v1/apporteurs", headers: authHeader(tokenCaissier) });
    expect(liste.statusCode).toBe(200);
    expect(liste.json()).toHaveLength(1);
  });

  it("un caissier ne peut pas créer d'apporteur (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/apporteurs",
      headers: authHeader(token),
      payload: { nom: "Jean Apporteur" },
    });

    expect(reponse.statusCode).toBe(403);
  });

  it("un apporteur consulte sa propre fiche mais pas celle d'un autre apporteur", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const apporteurA = (
      await app.inject({ method: "POST", url: "/api/v1/apporteurs", headers: authHeader(tokenAdmin), payload: { nom: "Apporteur A" } })
    ).json();
    const apporteurB = (
      await app.inject({ method: "POST", url: "/api/v1/apporteurs", headers: authHeader(tokenAdmin), payload: { nom: "Apporteur B" } })
    ).json();

    creerUtilisateur(db, {
      siteId,
      nom: "Compte",
      prenom: "ApporteurA",
      identifiant: "apporteurA",
      motDePasse: "motdepasse-secret",
      role: "APPORTEUR",
      idApporteur: apporteurA.idApporteur,
    });
    const tokenApporteurA = await connecter(app, "apporteurA");

    const propreFiche = await app.inject({
      method: "GET",
      url: `/api/v1/apporteurs/${apporteurA.idApporteur}/fiche`,
      headers: authHeader(tokenApporteurA),
    });
    expect(propreFiche.statusCode).toBe(200);

    const ficheAutrui = await app.inject({
      method: "GET",
      url: `/api/v1/apporteurs/${apporteurB.idApporteur}/fiche`,
      headers: authHeader(tokenApporteurA),
    });
    expect(ficheAutrui.statusCode).toBe(403);
  });

  it("un recrutement CANAL+ calcule automatiquement la commission à partir du taux vendeur par défaut (6.2, 8.8)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    const evasion = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get();

    await app.inject({
      method: "PATCH",
      url: "/api/v1/entreprise",
      headers: authHeader(tokenAdmin),
      payload: { tauxCommissionVendeurDefaut: 100 }, // 10 %
    });

    const recrutement = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(tokenAdmin),
      payload: { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule: evasion.idFormule, montantEncaisse: 10500 },
    });
    expect(recrutement.statusCode).toBe(201);

    const abonnes = await app.inject({ method: "GET", url: `/api/v1/abonnes?siteId=${siteId}&q=690000000`, headers: authHeader(tokenAdmin) });
    const idAbonne = abonnes.json()[0].idAbonne;

    const fiche = await app.inject({ method: "GET", url: `/api/v1/abonnes/${idAbonne}/fiche-360`, headers: authHeader(tokenAdmin) });
    expect(fiche.json().commissionsCanalplus).toHaveLength(1);
    expect(fiche.json().commissionsCanalplus[0].montantCommission).toBe(1050); // 10 % de 10500
  });
});

describe("Module suivi de stock (5.2)", () => {
  async function creerProduitSuivi(db: Db, siteId: number, seuilAlerte: number) {
    return db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000, coutRevient: 1000, suiviStock: 1, quantiteStock: 10, seuilAlerte })
      .returning()
      .get().idProduit;
  }

  it("un administrateur réceptionne un achat, un caissier peut consulter l'historique et les alertes", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");
    const idProduit = await creerProduitSuivi(db, siteId, 5);

    const achat = await app.inject({
      method: "POST",
      url: "/api/v1/stock/achats",
      headers: authHeader(tokenAdmin),
      payload: { idProduit, siteId, quantite: 10, coutUnitaire: 2000, userId },
    });
    expect(achat.statusCode).toBe(201);
    expect(achat.json().quantiteStock).toBe(20);

    const tokenCaissier = await connecter(app);
    const mouvements = await app.inject({
      method: "GET",
      url: `/api/v1/produits/${idProduit}/mouvements`,
      headers: authHeader(tokenCaissier),
    });
    expect(mouvements.statusCode).toBe(200);
    expect(mouvements.json()).toHaveLength(1);

    const alertes = await app.inject({ method: "GET", url: `/api/v1/stock/alertes?siteId=${siteId}`, headers: authHeader(tokenCaissier) });
    expect(alertes.statusCode).toBe(200);
    expect(alertes.json()).toHaveLength(0); // 20 > seuil 5
  });

  it("un caissier ne peut pas réceptionner un achat, enregistrer une casse ni ajuster l'inventaire (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const idProduit = await creerProduitSuivi(db, siteId, 5);

    const achat = await app.inject({
      method: "POST",
      url: "/api/v1/stock/achats",
      headers: authHeader(token),
      payload: { idProduit, siteId, quantite: 10, coutUnitaire: 2000, userId },
    });
    expect(achat.statusCode).toBe(403);

    const casse = await app.inject({
      method: "POST",
      url: "/api/v1/stock/casses",
      headers: authHeader(token),
      payload: { idProduit, siteId, quantite: 1, motif: "Chute", userId },
    });
    expect(casse.statusCode).toBe(403);

    const inventaire = await app.inject({
      method: "POST",
      url: "/api/v1/stock/inventaires",
      headers: authHeader(token),
      payload: { idProduit, siteId, quantiteComptee: 3, motif: "Comptage", userId },
    });
    expect(inventaire.statusCode).toBe(403);
  });

  it("une casse qui fait passer le stock sous le seuil déclenche l'alerte de rupture", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");
    const idProduit = await creerProduitSuivi(db, siteId, 5); // stock 10, seuil 5

    await app.inject({
      method: "POST",
      url: "/api/v1/stock/casses",
      headers: authHeader(tokenAdmin),
      payload: { idProduit, siteId, quantite: 6, motif: "Casse transport", userId },
    });

    const alertes = await app.inject({ method: "GET", url: `/api/v1/stock/alertes?siteId=${siteId}`, headers: authHeader(tokenAdmin) });
    expect(alertes.json()).toHaveLength(1); // 10 - 6 = 4 <= seuil 5
  });

  it("un administrateur transfère du stock vers un autre site, créant l'article là-bas s'il n'existe pas", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");
    const idProduit = await creerProduitSuivi(db, siteId, 5); // stock 10
    const idEntreprise = db.select().from(schema.site).where(eq(schema.site.idSite, siteId)).get()!.idEntreprise;
    const autreSite = db.insert(schema.site).values({ idEntreprise, nom: "Site B" }).returning().get().idSite;

    const transfert = await app.inject({
      method: "POST",
      url: "/api/v1/stock/transferts",
      headers: authHeader(tokenAdmin),
      payload: { idProduitSource: idProduit, siteDestinationId: autreSite, quantite: 4, userId },
    });

    expect(transfert.statusCode).toBe(201);
    expect(transfert.json().produitSource.quantiteStock).toBe(6);
    expect(transfert.json().produitDestination).toMatchObject({ siteId: autreSite, libelle: "Décodeur", quantiteStock: 4 });
  });

  it("un caissier ne peut pas transférer de stock (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const idProduit = await creerProduitSuivi(db, siteId, 5);
    const idEntreprise = db.select().from(schema.site).where(eq(schema.site.idSite, siteId)).get()!.idEntreprise;
    const autreSite = db.insert(schema.site).values({ idEntreprise, nom: "Site B" }).returning().get().idSite;

    const transfert = await app.inject({
      method: "POST",
      url: "/api/v1/stock/transferts",
      headers: authHeader(token),
      payload: { idProduitSource: idProduit, siteDestinationId: autreSite, quantite: 1, userId },
    });

    expect(transfert.statusCode).toBe(403);
  });
});

describe("Vente rapide de produits/services hors abonnement (5.2, 5.3, 8.5)", () => {
  async function creerBien(db: Db) {
    return db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Télécommande universelle", prixVente: 2500, suiviStock: 1, quantiteStock: 10 })
      .returning()
      .get().idProduit;
  }

  it("un caissier vend un produit au comptant : facture VALIDEE, stock décrémenté", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const idProduit = await creerBien(db);

    const vente = await app.inject({
      method: "POST",
      url: "/api/v1/ventes",
      headers: authHeader(token),
      payload: { siteId, userId, lignes: [{ idProduit, quantite: 2 }], montantEncaisse: 5000 },
    });

    expect(vente.statusCode).toBe(201);
    expect(vente.json()).toMatchObject({ statutFacture: "VALIDEE", montantTotal: 5000 });

    const produit = await app.inject({ method: "GET", url: `/api/v1/produits?siteId=${siteId}`, headers: authHeader(token) });
    expect(produit.json().find((p: { idProduit: number }) => p.idProduit === idProduit).quantiteStock).toBe(8);
  });

  it("un apporteur d'affaires ne peut pas réaliser de vente (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "A", prenom: "P", identifiant: "apporteur1", motDePasse: "motdepasse-secret", role: "APPORTEUR" });
    const token = await connecter(app, "apporteur1");
    const idProduit = await creerBien(db);

    const vente = await app.inject({
      method: "POST",
      url: "/api/v1/ventes",
      headers: authHeader(token),
      payload: { siteId, userId, lignes: [{ idProduit, quantite: 1 }], montantEncaisse: 2500 },
    });

    expect(vente.statusCode).toBe(403);
  });

  // 6.5 : "Chèque — Banque, numéro de chèque, titulaire, date" — round-trip
  // HTTP complet, et ventilation du tableau de bord (8.6) mise à jour
  it("un caissier vend un produit payé par chèque : la facture, le paiement et la ventilation du jour reflètent le chèque", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const idProduit = await creerBien(db);
    const aujourdHui = new Date().toISOString().slice(0, 10);

    const vente = await app.inject({
      method: "POST",
      url: "/api/v1/ventes",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        lignes: [{ idProduit, quantite: 1 }],
        montantEncaisse: 2500,
        modePaiement: "CHEQUE",
        banque: "Afriland First Bank",
        numeroCheque: "0012345",
        titulaireCheque: "Client Comptoir",
        dateCheque: aujourdHui,
      },
    });

    expect(vente.statusCode).toBe(201);
    expect(vente.json()).toMatchObject({ statutFacture: "VALIDEE" });

    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin-cheque", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin-cheque");
    const encaissements = await app.inject({
      method: "GET",
      url: `/api/v1/tableau-bord/encaissements-jour?siteId=${siteId}&aujourdHui=${aujourdHui}`,
      headers: authHeader(tokenAdmin),
    });
    expect(encaissements.statusCode).toBe(200);
    expect(encaissements.json().find((v: { mode: string }) => v.mode === "CHEQUE").total).toBe(2500);
  });
});

describe("Émission d'un avoir (6.4)", () => {
  async function creerFactureValidee(db: Db) {
    const produit = db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Télécommande", prixVente: 2500, suiviStock: 1, quantiteStock: 5 })
      .returning()
      .get();
    const facture = db.insert(schema.facture).values({ siteId, statut: "VALIDEE", montantTotal: 2 * 2500, creePar: userId }).returning().get();
    const ligne = db
      .insert(schema.ligneVente)
      .values({ idFacture: facture.idFacture, idProduit: produit.idProduit, quantite: 2, prixApplique: 2 * 2500 })
      .returning()
      .get();
    return { idFacture: facture.idFacture, idLigne: ligne.idLigne, idProduit: produit.idProduit };
  }

  it("un gérant émet un avoir avec restitution au stock", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Gerant", prenom: "G", identifiant: "gerant1", motDePasse: "motdepasse-secret", role: "GERANT" });
    const token = await connecter(app, "gerant1");
    const { idFacture, idLigne, idProduit } = await creerFactureValidee(db);

    const avoir = await app.inject({
      method: "POST",
      url: `/api/v1/factures/${idFacture}/avoir`,
      headers: authHeader(token),
      payload: { lignes: [{ idLigneOrigine: idLigne, quantite: 2 }], restituerStock: true, userId },
    });

    expect(avoir.statusCode).toBe(201);
    expect(avoir.json().montantTotal).toBe(-5000);

    const produit = await app.inject({ method: "GET", url: `/api/v1/produits?siteId=${siteId}`, headers: authHeader(token) });
    expect(produit.json().find((p: { idProduit: number }) => p.idProduit === idProduit).quantiteStock).toBe(7);
  });

  it("liste les lignes d'une facture avec le libellé de l'article, accessible à un rôle de vente", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const { idFacture } = await creerFactureValidee(db);

    const lignes = await app.inject({ method: "GET", url: `/api/v1/factures/${idFacture}/lignes`, headers: authHeader(token) });

    expect(lignes.statusCode).toBe(200);
    expect(lignes.json()).toMatchObject([{ libelleProduit: "Télécommande", quantite: 2, prixApplique: 5000 }]);
  });

  it("un caissier ne peut pas émettre d'avoir (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const { idFacture, idLigne } = await creerFactureValidee(db);

    const avoir = await app.inject({
      method: "POST",
      url: `/api/v1/factures/${idFacture}/avoir`,
      headers: authHeader(token),
      payload: { lignes: [{ idLigneOrigine: idLigne, quantite: 1 }], restituerStock: false, userId },
    });

    expect(avoir.statusCode).toBe(403);
  });

  it("rejette un avoir sur une facture BROUILLON (400)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Gerant", prenom: "G", identifiant: "gerant1", motDePasse: "motdepasse-secret", role: "GERANT" });
    const token = await connecter(app, "gerant1");
    const produit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Câble", prixVente: 1000 }).returning().get();
    const facture = db.insert(schema.facture).values({ siteId, statut: "BROUILLON", montantTotal: 1000, creePar: userId }).returning().get();
    const ligne = db.insert(schema.ligneVente).values({ idFacture: facture.idFacture, idProduit: produit.idProduit, quantite: 1, prixApplique: 1000 }).returning().get();

    const avoir = await app.inject({
      method: "POST",
      url: `/api/v1/factures/${facture.idFacture}/avoir`,
      headers: authHeader(token),
      payload: { lignes: [{ idLigneOrigine: ligne.idLigne, quantite: 1 }], restituerStock: false, userId },
    });

    expect(avoir.statusCode).toBe(400);
  });
});

describe("Module gestion du catalogue (8.2)", () => {
  it("un administrateur crée un article, un caissier peut le consulter mais pas le créer", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/produits",
      headers: authHeader(tokenAdmin),
      payload: { siteId, type: "BIEN", libelle: "Câble HDMI", categorie: "Accessoires", prixVente: 2500, coutRevient: 1000, margeType: "VALEUR", margeValeur: 1500 },
    });
    expect(creation.statusCode).toBe(201);
    expect(creation.json().margePourcentage).toBe(15000);

    const tokenCaissier = await connecter(app);
    const liste = await app.inject({ method: "GET", url: `/api/v1/produits?siteId=${siteId}`, headers: authHeader(tokenCaissier) });
    expect(liste.statusCode).toBe(200);
    expect(liste.json()).toHaveLength(1);

    const refusCreation = await app.inject({
      method: "POST",
      url: "/api/v1/produits",
      headers: authHeader(tokenCaissier),
      payload: { siteId, type: "BIEN", libelle: "Autre", prixVente: 1000 },
    });
    expect(refusCreation.statusCode).toBe(403);
  });

  it("l'édition d'un article journalise l'historique de prix, consultable par tout rôle authentifié", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const produit = (
      await app.inject({
        method: "POST",
        url: "/api/v1/produits",
        headers: authHeader(tokenAdmin),
        payload: { siteId, type: "BIEN", libelle: "Décodeur", prixVente: 15000, coutRevient: 8000 },
      })
    ).json();

    const edition = await app.inject({
      method: "PATCH",
      url: `/api/v1/produits/${produit.idProduit}`,
      headers: authHeader(tokenAdmin),
      payload: { prixVente: 16000, userId },
    });
    expect(edition.statusCode).toBe(200);
    expect(edition.json().prixVente).toBe(16000);

    const tokenCaissier = await connecter(app);
    const historique = await app.inject({
      method: "GET",
      url: `/api/v1/produits/${produit.idProduit}/historique-prix`,
      headers: authHeader(tokenCaissier),
    });
    expect(historique.statusCode).toBe(200);
    expect(historique.json()).toHaveLength(1);
    expect(historique.json()[0].prixVenteApres).toBe(16000);

    const refusEdition = await app.inject({
      method: "PATCH",
      url: `/api/v1/produits/${produit.idProduit}`,
      headers: authHeader(tokenCaissier),
      payload: { prixVente: 20000, userId },
    });
    expect(refusEdition.statusCode).toBe(403);
  });

  it("8.2 : exporte le catalogue en CSV puis le réimporte pour mettre à jour un prix, réservé à l'encadrement", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    await app.inject({
      method: "POST",
      url: "/api/v1/produits",
      headers: authHeader(tokenAdmin),
      payload: { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500 },
    });

    const export1 = await app.inject({ method: "GET", url: `/api/v1/produits/export-csv?siteId=${siteId}`, headers: authHeader(tokenAdmin) });
    expect(export1.statusCode).toBe(200);
    expect(export1.headers["content-type"]).toContain("text/csv");
    expect(export1.body).toContain("Câble HDMI");

    const contenuCsv = export1.body.replace("2500", "3200");
    const import1 = await app.inject({
      method: "POST",
      url: "/api/v1/produits/import-csv",
      headers: authHeader(tokenAdmin),
      payload: { siteId, userId, contenuCsv },
    });
    expect(import1.statusCode).toBe(200);
    expect(import1.json()).toMatchObject({ crees: 0, misAJour: 1, erreurs: [] });

    const tokenCaissier = await connecter(app);
    const refusExport = await app.inject({ method: "GET", url: `/api/v1/produits/export-csv?siteId=${siteId}`, headers: authHeader(tokenCaissier) });
    expect(refusExport.statusCode).toBe(403);
    const refusImport = await app.inject({
      method: "POST",
      url: "/api/v1/produits/import-csv",
      headers: authHeader(tokenCaissier),
      payload: { siteId, userId, contenuCsv },
    });
    expect(refusImport.statusCode).toBe(403);
  });
});

// fournisseur entièrement pilotable pour les tests HTTP — indépendant du
// minuteur réel du simulateur (SimulateurOrangeMoney)
class FournisseurPaiementMobileFactice {
  statut: "EN_ATTENTE" | "REUSSIE" | "ECHOUEE" | "EXPIREE" = "EN_ATTENTE";
  async initier() {
    return { referenceFournisseur: "REF-HTTP-TEST" };
  }
  async consulterStatut() {
    return this.statut;
  }
}

describe("Module paiement mobile Orange Money (6.6)", () => {
  it("cycle complet : recrutement sans encaissement -> paiement mobile -> facture validée", async () => {
    const fournisseur = new FournisseurPaiementMobileFactice();
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST, fournisseurPaiementMobile: fournisseur });
    const token = await connecter(app);

    const recrutement = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
        idFormule,
        montantEncaisse: 0,
      },
    });
    expect(recrutement.statusCode).toBe(201);
    const { idFacture } = recrutement.json();

    const initiation = await app.inject({
      method: "POST",
      url: "/api/v1/paiements-mobiles",
      headers: authHeader(token),
      payload: { idFacture, numeroTelephone: "690000000", montant: 13000, parcours: "USSD_CLIENT" },
    });
    expect(initiation.statusCode).toBe(201);
    expect(initiation.json().statut).toBe("EN_ATTENTE");
    const idTransaction = initiation.json().idTransaction;

    // avant confirmation de l'opérateur : la facture reste BROUILLON
    const avantConfirmation = await app.inject({
      method: "POST",
      url: `/api/v1/paiements-mobiles/${idTransaction}/actualiser`,
      headers: authHeader(token),
    });
    expect(avantConfirmation.json().statut).toBe("EN_ATTENTE");

    fournisseur.statut = "REUSSIE";
    const confirmation = await app.inject({
      method: "POST",
      url: `/api/v1/paiements-mobiles/${idTransaction}/actualiser`,
      headers: authHeader(token),
    });
    expect(confirmation.statusCode).toBe(200);
    expect(confirmation.json().statut).toBe("REUSSIE");

    const consultation = await app.inject({ method: "GET", url: `/api/v1/paiements-mobiles/${idTransaction}`, headers: authHeader(token) });
    expect(consultation.json().statut).toBe("REUSSIE");
  });

  it("un rôle non habilité à la vente ne peut pas initier de paiement mobile (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Comptable", prenom: "C", identifiant: "comptable1", motDePasse: "motdepasse-secret", role: "COMPTABLE" });
    const token = await connecter(app, "comptable1");

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/paiements-mobiles",
      headers: authHeader(token),
      payload: { idFacture: 1, numeroTelephone: "690000000", montant: 5000, parcours: "USSD_CLIENT" },
    });
    expect(reponse.statusCode).toBe(403);
  });

  it("renvoie 404 pour une transaction inconnue", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({ method: "GET", url: "/api/v1/paiements-mobiles/999999", headers: authHeader(token) });
    expect(reponse.statusCode).toBe(404);
  });
});

describe("Module changement de formule / migration (7.4)", () => {
  it("migre vers une formule supérieure, facture le différentiel et journalise le changement", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const idFamilleDstv = db.select().from(schema.formule).where(eq(schema.formule.idFormule, idFormule)).get()!.idFamille;
    const idFormuleSuperieure = db
      .insert(schema.formule)
      .values({ idFamille: idFamilleDstv, libelle: "PREMIUM", prix: 28000, rang: 5 })
      .returning()
      .get().idFormule;

    const recrutement = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule, montantEncaisse: 13000 },
    });
    const { numeroAbonnement } = recrutement.json();

    const migration = await app.inject({
      method: "POST",
      url: `/api/v1/abonnements/${numeroAbonnement}/changement-formule`,
      headers: authHeader(token),
      payload: { siteId, userId, idNouvelleFormule: idFormuleSuperieure, montantEncaisse: 15000 },
    });

    expect(migration.statusCode).toBe(200);
    expect(migration.json().montantDifferentiel).toBe(15000); // 28000 - 13000
    expect(migration.json().statutFacture).toBe("VALIDEE");
  });

  it("rejette une migration vers une formule de rang inférieur (400)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const recrutement = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule, montantEncaisse: 13000 },
    });
    const { numeroAbonnement } = recrutement.json();

    const idFamilleDstv = db.select().from(schema.formule).where(eq(schema.formule.idFormule, idFormule)).get()!.idFamille;
    const idFormuleInferieure = db
      .insert(schema.formule)
      .values({ idFamille: idFamilleDstv, libelle: "YANGA", prix: 5000, rang: 1 })
      .returning()
      .get().idFormule;

    const migration = await app.inject({
      method: "POST",
      url: `/api/v1/abonnements/${numeroAbonnement}/changement-formule`,
      headers: authHeader(token),
      payload: { siteId, userId, idNouvelleFormule: idFormuleInferieure, montantEncaisse: 0 },
    });

    expect(migration.statusCode).toBe(400);
  });

  it("un rôle non habilité à la vente ne peut pas migrer une formule (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const recrutement = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule, montantEncaisse: 13000 },
    });
    const { numeroAbonnement } = recrutement.json();

    creerUtilisateur(db, { siteId, nom: "Tech", prenom: "T", identifiant: "tech1", motDePasse: "motdepasse-secret", role: "TECHNICIEN_SAV" });
    const tokenTech = await connecter(app, "tech1");

    const reponse = await app.inject({
      method: "POST",
      url: `/api/v1/abonnements/${numeroAbonnement}/changement-formule`,
      headers: authHeader(tokenTech),
      payload: { siteId, userId, idNouvelleFormule: idFormule, montantEncaisse: 0 },
    });
    expect(reponse.statusCode).toBe(403);
  });

  it("renvoie 404 pour un abonnement inconnu", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/abonnements/999999/changement-formule",
      headers: authHeader(token),
      payload: { siteId, userId, idNouvelleFormule: idFormule, montantEncaisse: 0 },
    });
    expect(reponse.statusCode).toBe(404);
  });
});

describe("Fiche client 360° et fusion de doublons (8.1)", () => {
  async function creerAbonneViaRecrutement(app: FastifyInstance, token: string, nom: string, telephone: string) {
    const recrutement = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom, prenom: "Test", telephone }, idFormule, montantEncaisse: 13000 },
    });
    const abonnements = await app.inject({
      method: "GET",
      url: `/api/v1/abonnes?siteId=${siteId}&q=${telephone}`,
      headers: authHeader(token),
    });
    return { idAbonne: abonnements.json()[0].idAbonne as number, numeroAbonnement: recrutement.json().numeroAbonnement as number };
  }

  it("consulte la fiche 360° d'un abonné (abonnements, factures, SAV consolidés)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const { idAbonne } = await creerAbonneViaRecrutement(app, token, "Nga Ndongo", "690000000");

    const fiche = await app.inject({ method: "GET", url: `/api/v1/abonnes/${idAbonne}/fiche-360`, headers: authHeader(token) });

    expect(fiche.statusCode).toBe(200);
    expect(fiche.json().abonne.nom).toBe("Nga Ndongo");
    expect(fiche.json().abonnements).toHaveLength(1);
    expect(fiche.json().factures).toHaveLength(1);
  });

  it("modifie les coordonnées d'un abonné", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const { idAbonne } = await creerAbonneViaRecrutement(app, token, "Nga Ndongo", "690000000");

    const modification = await app.inject({
      method: "PATCH",
      url: `/api/v1/abonnes/${idAbonne}`,
      headers: authHeader(token),
      payload: { email: "valentin@example.cm" },
    });

    expect(modification.statusCode).toBe(200);
    expect(modification.json().email).toBe("valentin@example.cm");
  });

  it("un administrateur fusionne deux fiches doublons, l'historique du doublon est conservé", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");
    const { idAbonne: idPrincipal } = await creerAbonneViaRecrutement(app, tokenAdmin, "Nga Ndongo", "690000000");
    const { idAbonne: idDoublon } = await creerAbonneViaRecrutement(app, tokenAdmin, "Nga N.", "690000001");

    const fusion = await app.inject({
      method: "POST",
      url: "/api/v1/abonnes/fusion",
      headers: authHeader(tokenAdmin),
      payload: { idAbonnePrincipal: idPrincipal, idAbonneDoublon: idDoublon, userId },
    });
    expect(fusion.statusCode).toBe(200);

    const fiche = await app.inject({ method: "GET", url: `/api/v1/abonnes/${idPrincipal}/fiche-360`, headers: authHeader(tokenAdmin) });
    expect(fiche.json().abonnements).toHaveLength(2); // les deux abonnements sont désormais rattachés au principal

    const doublonSupprime = await app.inject({ method: "GET", url: `/api/v1/abonnes/${idDoublon}`, headers: authHeader(tokenAdmin) });
    expect(doublonSupprime.statusCode).toBe(404);
  });

  it("un caissier ne peut pas fusionner des doublons (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const { idAbonne: idPrincipal } = await creerAbonneViaRecrutement(app, token, "Nga Ndongo", "690000000");
    const { idAbonne: idDoublon } = await creerAbonneViaRecrutement(app, token, "Nga N.", "690000001");

    const reponse = await app.inject({
      method: "POST",
      url: "/api/v1/abonnes/fusion",
      headers: authHeader(token),
      payload: { idAbonnePrincipal: idPrincipal, idAbonneDoublon: idDoublon, userId },
    });
    expect(reponse.statusCode).toBe(403);
  });

  it("renvoie 404 pour une fiche 360° d'un abonné inconnu", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({ method: "GET", url: "/api/v1/abonnes/999999/fiche-360", headers: authHeader(token) });
    expect(reponse.statusCode).toBe(404);
  });

  it("11.3 : un administrateur anonymise la fiche d'un abonné — identité effacée, historique conservé", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");
    const { idAbonne } = await creerAbonneViaRecrutement(app, tokenAdmin, "Nga Ndongo", "690000000");

    const reponse = await app.inject({
      method: "POST",
      url: `/api/v1/abonnes/${idAbonne}/anonymiser`,
      headers: authHeader(tokenAdmin),
      payload: { userId },
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().nom).not.toBe("Nga Ndongo");

    const fiche = await app.inject({ method: "GET", url: `/api/v1/abonnes/${idAbonne}/fiche-360`, headers: authHeader(tokenAdmin) });
    expect(fiche.json().abonnements).toHaveLength(1);
    expect(fiche.json().factures).toHaveLength(1);
  });

  it("11.3 : un gérant ne peut pas anonymiser une fiche abonné, réservé à l'administrateur (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Gerant", prenom: "G", identifiant: "gerant1", motDePasse: "motdepasse-secret", role: "GERANT" });
    const tokenGerant = await connecter(app, "gerant1");
    const { idAbonne } = await creerAbonneViaRecrutement(app, tokenGerant, "Nga Ndongo", "690000000");

    const reponse = await app.inject({
      method: "POST",
      url: `/api/v1/abonnes/${idAbonne}/anonymiser`,
      headers: authHeader(tokenGerant),
      payload: { userId },
    });

    expect(reponse.statusCode).toBe(403);
  });
});

describe("Tableau de bord de pilotage (8.6, 9.3)", () => {
  it("un administrateur consulte les indicateurs, l'évolution du CA, la valorisation, les encaissements et les commissions", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const token = await connecter(app, "admin1");
    const aujourdHui = new Date().toISOString().slice(0, 10);

    await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui, abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule, montantEncaisse: 13000 },
    });

    const indicateurs = await app.inject({
      method: "GET",
      url: `/api/v1/tableau-bord/indicateurs?siteId=${siteId}&aujourdHui=${aujourdHui}`,
      headers: authHeader(token),
    });
    expect(indicateurs.statusCode).toBe(200);
    expect(indicateurs.json().chiffreAffairesJour).toBe(13000);

    const evolution = await app.inject({
      method: "GET",
      url: `/api/v1/tableau-bord/evolution-ca?siteId=${siteId}&aujourdHui=${aujourdHui}&jours=7`,
      headers: authHeader(token),
    });
    expect(evolution.statusCode).toBe(200);
    expect(evolution.json()).toHaveLength(7);

    const valorisation = await app.inject({ method: "GET", url: `/api/v1/tableau-bord/valorisation-stock?siteId=${siteId}`, headers: authHeader(token) });
    expect(valorisation.statusCode).toBe(200);

    const encaissements = await app.inject({
      method: "GET",
      url: `/api/v1/tableau-bord/encaissements-jour?siteId=${siteId}&aujourdHui=${aujourdHui}`,
      headers: authHeader(token),
    });
    expect(encaissements.statusCode).toBe(200);
    expect(encaissements.json().find((v: { mode: string }) => v.mode === "CASH").total).toBe(13000);

    const commissions = await app.inject({ method: "GET", url: `/api/v1/tableau-bord/commissions-canalplus?siteId=${siteId}`, headers: authHeader(token) });
    expect(commissions.statusCode).toBe(200);
  });

  it("un caissier n'a pas accès au tableau de bord de pilotage (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const aujourdHui = new Date().toISOString().slice(0, 10);

    const reponse = await app.inject({
      method: "GET",
      url: `/api/v1/tableau-bord/indicateurs?siteId=${siteId}&aujourdHui=${aujourdHui}`,
      headers: authHeader(token),
    });
    expect(reponse.statusCode).toBe(403);
  });
});

describe("Module gestion des utilisateurs, rôles et sites (8.7)", () => {
  async function connecterAdmin(app: FastifyInstance) {
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    return connecter(app, "admin1");
  }

  it("un administrateur crée un compte, le liste puis désactive et change son rôle", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const tokenAdmin = await connecterAdmin(app);

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/utilisateurs",
      headers: authHeader(tokenAdmin),
      payload: { nom: "Nga", prenom: "Valentin", identifiant: "vnga", motDePasse: "motdepasse-secret", role: "CAISSIER" },
    });
    expect(creation.statusCode).toBe(201);
    expect(creation.json()).not.toHaveProperty("motDePasseHash");
    const idNouveau = creation.json().idUser;

    const liste = await app.inject({ method: "GET", url: "/api/v1/utilisateurs", headers: authHeader(tokenAdmin) });
    expect(liste.statusCode).toBe(200);
    // le caissier créé au beforeEach + l'admin connecté + le nouveau compte
    expect(liste.json()).toHaveLength(3);

    const modification = await app.inject({
      method: "PATCH",
      url: `/api/v1/utilisateurs/${idNouveau}`,
      headers: authHeader(tokenAdmin),
      payload: { actif: false, role: "GERANT" },
    });
    expect(modification.statusCode).toBe(200);
    expect(modification.json().actif).toBe(0);
    expect(modification.json().role).toBe("GERANT");
  });

  it("un caissier ne peut ni lister ni créer de compte (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const tokenCaissier = await connecter(app);

    const liste = await app.inject({ method: "GET", url: "/api/v1/utilisateurs", headers: authHeader(tokenCaissier) });
    expect(liste.statusCode).toBe(403);

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/utilisateurs",
      headers: authHeader(tokenCaissier),
      payload: { nom: "X", prenom: "Y", identifiant: "xy", motDePasse: "motdepasse-secret", role: "CAISSIER" },
    });
    expect(creation.statusCode).toBe(403);
  });

  it("un administrateur ne peut pas désactiver son propre compte (400)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const tokenAdmin = await connecterAdmin(app);
    const idAdmin = (await app.inject({ method: "GET", url: "/api/v1/utilisateurs", headers: authHeader(tokenAdmin) }))
      .json()
      .find((u: { identifiant: string }) => u.identifiant === "admin1").idUser;

    const reponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/utilisateurs/${idAdmin}`,
      headers: authHeader(tokenAdmin),
      payload: { actif: false },
    });

    expect(reponse.statusCode).toBe(400);
  });

  it("renvoie 404 pour un utilisateur inconnu", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const tokenAdmin = await connecterAdmin(app);

    const reponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/utilisateurs/999999",
      headers: authHeader(tokenAdmin),
      payload: { actif: false },
    });

    expect(reponse.statusCode).toBe(404);
  });

  it("un administrateur crée un site et le liste parmi ceux de son entreprise", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const tokenAdmin = await connecterAdmin(app);

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/sites",
      headers: authHeader(tokenAdmin),
      payload: { nom: "Site Bonamoussadi", adresse: "Douala" },
    });
    expect(creation.statusCode).toBe(201);

    const liste = await app.inject({ method: "GET", url: "/api/v1/sites", headers: authHeader(tokenAdmin) });
    expect(liste.statusCode).toBe(200);
    expect(liste.json().map((s: { nom: string }) => s.nom)).toContain("Site Bonamoussadi");
    expect(liste.json()).toHaveLength(2);

    const idNouveauSite = creation.json().idSite;
    const modification = await app.inject({
      method: "PATCH",
      url: `/api/v1/sites/${idNouveauSite}`,
      headers: authHeader(tokenAdmin),
      payload: { adresse: "Nouvelle adresse" },
    });
    expect(modification.statusCode).toBe(200);
    expect(modification.json().adresse).toBe("Nouvelle adresse");
  });

  it("journalise et consulte l'audit d'une fusion de doublons, filtrable par table cible", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const tokenAdmin = await connecterAdmin(app);

    async function creerAbonneViaRecrutement(telephone: string) {
      await app.inject({
        method: "POST",
        url: "/api/v1/recrutements",
        headers: authHeader(tokenAdmin),
        payload: { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom: "Nga", prenom: "Paul", telephone }, idFormule, montantEncaisse: 13000 },
      });
      const abonnes = await app.inject({ method: "GET", url: `/api/v1/abonnes?siteId=${siteId}&q=${telephone}`, headers: authHeader(tokenAdmin) });
      return abonnes.json()[0].idAbonne as number;
    }

    const idPrincipal = await creerAbonneViaRecrutement("690000000");
    const idDoublon = await creerAbonneViaRecrutement("690000001");

    const fusion = await app.inject({
      method: "POST",
      url: "/api/v1/abonnes/fusion",
      headers: authHeader(tokenAdmin),
      payload: { idAbonnePrincipal: idPrincipal, idAbonneDoublon: idDoublon, userId },
    });
    expect(fusion.statusCode).toBe(200);

    const journal = await app.inject({ method: "GET", url: "/api/v1/audit", headers: authHeader(tokenAdmin) });
    expect(journal.statusCode).toBe(200);
    expect(journal.json().length).toBeGreaterThanOrEqual(1);
    expect(journal.json()[0].tableCible).toBe("abonne");

    const journalFiltre = await app.inject({ method: "GET", url: "/api/v1/audit?tableCible=produit", headers: authHeader(tokenAdmin) });
    expect(journalFiltre.statusCode).toBe(200);
    expect(journalFiltre.json()).toHaveLength(0);
  });

  it("un caissier ne peut pas consulter le journal d'audit ni gérer les sites (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const tokenCaissier = await connecter(app);

    const audit = await app.inject({ method: "GET", url: "/api/v1/audit", headers: authHeader(tokenCaissier) });
    expect(audit.statusCode).toBe(403);

    const sites = await app.inject({ method: "GET", url: "/api/v1/sites", headers: authHeader(tokenCaissier) });
    expect(sites.statusCode).toBe(403);
  });
});

describe("Back-office catalogue : familles, formules, options (8.8)", () => {
  it("un administrateur crée une famille, une formule puis la modifie ; le catalogue de vente reflète le changement", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const famille = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/familles",
      headers: authHeader(tokenAdmin),
      payload: { libelle: "MOREPLEX" },
    });
    expect(famille.statusCode).toBe(201);

    const formule = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/formules",
      headers: authHeader(tokenAdmin),
      payload: { idFamille: famille.json().idFamille, libelle: "ESSENTIEL", prix: 4000, rang: 1 },
    });
    expect(formule.statusCode).toBe(201);

    const catalogue = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: authHeader(tokenAdmin) });
    expect(catalogue.json().find((f: { libelle: string }) => f.libelle === "MOREPLEX").formules).toHaveLength(1);

    const modification = await app.inject({
      method: "PATCH",
      url: `/api/v1/catalogue/formules/${formule.json().idFormule}`,
      headers: authHeader(tokenAdmin),
      payload: { prix: 4500, actif: false },
    });
    expect(modification.statusCode).toBe(200);
    expect(modification.json().prix).toBe(4500);

    const catalogueApres = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: authHeader(tokenAdmin) });
    expect(catalogueApres.json().find((f: { libelle: string }) => f.libelle === "MOREPLEX").formules).toHaveLength(0);

    // le back-office, lui, continue de voir la formule désactivée
    const formulesBackOffice = await app.inject({
      method: "GET",
      url: `/api/v1/catalogue/formules?idFamille=${famille.json().idFamille}`,
      headers: authHeader(tokenAdmin),
    });
    expect(formulesBackOffice.statusCode).toBe(200);
    expect(formulesBackOffice.json()).toHaveLength(1);
    expect(formulesBackOffice.json()[0].actif).toBe(0);
  });

  it("crée une option, la lie à une formule avec un prix de surcharge, puis la délie", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const option = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/options",
      headers: authHeader(tokenAdmin),
      payload: { libelle: "Bouquet Sport+", prix: 2000 },
    });
    expect(option.statusCode).toBe(201);

    const compat = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/options/compat",
      headers: authHeader(tokenAdmin),
      payload: { idFormule, idOption: option.json().idOption, prixSurcharge: 2500 },
    });
    expect(compat.statusCode).toBe(200);

    const liste = await app.inject({ method: "GET", url: "/api/v1/catalogue/options", headers: authHeader(tokenAdmin) });
    expect(liste.json()[0].formulesCompatibles).toEqual([{ idFormule, prixSurcharge: 2500 }]);

    const suppression = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalogue/options/${option.json().idOption}/compat/${idFormule}`,
      headers: authHeader(tokenAdmin),
    });
    expect(suppression.statusCode).toBe(204);

    const listeApres = await app.inject({ method: "GET", url: "/api/v1/catalogue/options", headers: authHeader(tokenAdmin) });
    expect(listeApres.json()[0].formulesCompatibles).toHaveLength(0);
  });

  it("un caissier ne peut ni créer de famille, ni de formule, ni d'option (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const famille = await app.inject({ method: "POST", url: "/api/v1/catalogue/familles", headers: authHeader(token), payload: { libelle: "X" } });
    expect(famille.statusCode).toBe(403);

    const formule = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/formules",
      headers: authHeader(token),
      payload: { idFamille: 1, libelle: "X", prix: 1000, rang: 1 },
    });
    expect(formule.statusCode).toBe(403);

    const option = await app.inject({ method: "POST", url: "/api/v1/catalogue/options", headers: authHeader(token), payload: { libelle: "X", prix: 1000 } });
    expect(option.statusCode).toBe(403);
  });

  it("renvoie 404 pour la modification d'une formule inconnue", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const reponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/catalogue/formules/999999",
      headers: authHeader(tokenAdmin),
      payload: { prix: 1000 },
    });

    expect(reponse.statusCode).toBe(404);
  });
});

describe("Back-office catalogue : règles de prix dynamique des kits (5.1.1, 8.8)", () => {
  it("un administrateur crée un kit à différentiel, le modifie, et le catalogue de vente reflète le changement", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "STARTIMES" }).returning().get();
    const compaq = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 }).returning().get();

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/kits",
      headers: authHeader(tokenAdmin),
      payload: { idFamille: famille.idFamille, libelle: "KIT DSTV COMPAQ", reglePrix: "PRIX_KIT_FIXE_PAR_DIFFERENTIEL", idFormuleReference: compaq.idFormule, prixKitReference: 55000 },
    });
    expect(creation.statusCode).toBe(201);
    const idKit = creation.json().idKit;

    const catalogue = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: authHeader(tokenAdmin) });
    const kitVente = catalogue.json().find((f: { idFamille: number }) => f.idFamille === famille.idFamille).kits[0];
    expect(kitVente.reglePrix).toBe("PRIX_KIT_FIXE_PAR_DIFFERENTIEL");
    expect(kitVente.prixKitReference).toBe(55000);

    const modification = await app.inject({
      method: "PATCH",
      url: `/api/v1/catalogue/kits/${idKit}`,
      headers: authHeader(tokenAdmin),
      payload: { prixKitReference: 58000 },
    });
    expect(modification.statusCode).toBe(200);
    expect(modification.json().prixKitReference).toBe(58000);

    const listeBackOffice = await app.inject({ method: "GET", url: `/api/v1/catalogue/kits?idFamille=${famille.idFamille}`, headers: authHeader(tokenAdmin) });
    expect(listeBackOffice.statusCode).toBe(200);
    expect(listeBackOffice.json()).toHaveLength(1);
  });

  it("définit puis retire un prix décodeur par formule sur un kit à prix variable", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    const evasion = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get();
    const kit = (
      await app.inject({
        method: "POST",
        url: "/api/v1/catalogue/kits",
        headers: authHeader(tokenAdmin),
        payload: { idFamille: famille.idFamille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE" },
      })
    ).json();

    const definition = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/kits/prix-decodeur",
      headers: authHeader(tokenAdmin),
      payload: { idKit: kit.idKit, idFormule: evasion.idFormule, prixDecodeur: 5000 },
    });
    expect(definition.statusCode).toBe(200);

    const catalogue = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: authHeader(tokenAdmin) });
    const kitVente = catalogue.json().find((f: { idFamille: number }) => f.idFamille === famille.idFamille).kits[0];
    expect(kitVente.prixDecodeurParFormule[evasion.idFormule]).toBe(5000);

    const suppression = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalogue/kits/${kit.idKit}/prix-decodeur/${evasion.idFormule}`,
      headers: authHeader(tokenAdmin),
    });
    expect(suppression.statusCode).toBe(204);

    const catalogueApres = await app.inject({ method: "GET", url: "/api/v1/catalogue", headers: authHeader(tokenAdmin) });
    const kitApres = catalogueApres.json().find((f: { idFamille: number }) => f.idFamille === famille.idFamille).kits[0];
    expect(kitApres.prixDecodeurParFormule[evasion.idFormule]).toBeUndefined();
  });

  it("un caissier ne peut ni créer ni modifier de kit (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "MOREPLEX" }).returning().get();

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/kits",
      headers: authHeader(token),
      payload: { idFamille: famille.idFamille, libelle: "KIT X", reglePrix: "PRIX_FIXE", prixFixe: 30000 },
    });
    expect(creation.statusCode).toBe(403);
  });

  it("renvoie 404 pour la modification d'un kit inconnu", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const reponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/catalogue/kits/999999",
      headers: authHeader(tokenAdmin),
      payload: { prixFixe: 1000 },
    });

    expect(reponse.statusCode).toBe(404);
  });

  it("5.1, 5.2 : définit puis retire un composant physique d'un kit, et la vente du kit décrémente son stock", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    const formule = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get();
    const kit = (
      await app.inject({
        method: "POST",
        url: "/api/v1/catalogue/kits",
        headers: authHeader(tokenAdmin),
        payload: { idFamille: famille.idFamille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_FIXE", prixFixe: 15000 },
      })
    ).json();
    const decodeur = db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Décodeur GLOBALZ", prixVente: 15000, suiviStock: 1, quantiteStock: 5 })
      .returning()
      .get();

    const definition = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/kits/composants",
      headers: authHeader(tokenAdmin),
      payload: { idKit: kit.idKit, idProduit: decodeur.idProduit, quantite: 1 },
    });
    expect(definition.statusCode).toBe(200);

    const composants = await app.inject({ method: "GET", url: `/api/v1/catalogue/kits/${kit.idKit}/composants`, headers: authHeader(tokenAdmin) });
    expect(composants.json()).toEqual([{ idKit: kit.idKit, idProduit: decodeur.idProduit, quantite: 1 }]);

    await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(tokenAdmin),
      payload: { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" }, idFormule: formule.idFormule, idKit: kit.idKit, montantEncaisse: 0 },
    });
    const produitApresVente = await app.inject({ method: "GET", url: `/api/v1/produits?siteId=${siteId}`, headers: authHeader(tokenAdmin) });
    expect(produitApresVente.json().find((p: { idProduit: number }) => p.idProduit === decodeur.idProduit).quantiteStock).toBe(4);

    const suppression = await app.inject({
      method: "DELETE",
      url: `/api/v1/catalogue/kits/${kit.idKit}/composants/${decodeur.idProduit}`,
      headers: authHeader(tokenAdmin),
    });
    expect(suppression.statusCode).toBe(204);
    const composantsApres = await app.inject({ method: "GET", url: `/api/v1/catalogue/kits/${kit.idKit}/composants`, headers: authHeader(tokenAdmin) });
    expect(composantsApres.json()).toEqual([]);
  });

  it("un caissier ne peut pas définir de composant de kit (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    const kit = db.insert(schema.kit).values({ idFamille: famille.idFamille, libelle: "KIT X", reglePrix: "PRIX_FIXE", prixFixe: 1000 }).returning().get();
    const produit = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Décodeur", prixVente: 1000 }).returning().get();

    const definition = await app.inject({
      method: "POST",
      url: "/api/v1/catalogue/kits/composants",
      headers: authHeader(token),
      payload: { idKit: kit.idKit, idProduit: produit.idProduit, quantite: 1 },
    });
    expect(definition.statusCode).toBe(403);
  });
});

describe("GET /api/v1/entreprise (6.7)", () => {
  it("renvoie l'entreprise et le site pour l'en-tête des documents commerciaux, à tout rôle authentifié", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({ method: "GET", url: "/api/v1/entreprise", headers: authHeader(token) });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().entreprise.nom).toBe("Boutique Test");
    expect(reponse.json().site.nom).toBe("Site A");
  });

  it("rejette une requête non authentifiée (401)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({ method: "GET", url: "/api/v1/entreprise" });

    expect(reponse.statusCode).toBe(401);
  });

  it("un administrateur définit le taux de TVA et les mentions légales, reflétés dans l'en-tête", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const modification = await app.inject({
      method: "PATCH",
      url: "/api/v1/entreprise",
      headers: authHeader(tokenAdmin),
      payload: { tauxTva: 1925, mentionsLegales: "RC/DLA/2024/B/1234", tauxCommissionVendeurDefaut: 100 },
    });
    expect(modification.statusCode).toBe(200);
    expect(modification.json().tauxTva).toBe(1925);
    expect(modification.json().tauxCommissionVendeurDefaut).toBe(100);

    const reponse = await app.inject({ method: "GET", url: "/api/v1/entreprise", headers: authHeader(tokenAdmin) });
    expect(reponse.json().entreprise.tauxTva).toBe(1925);
    expect(reponse.json().entreprise.mentionsLegales).toBe("RC/DLA/2024/B/1234");
    expect(reponse.json().entreprise.tauxCommissionVendeurDefaut).toBe(100);
  });

  it("un caissier ne peut pas modifier le taux de TVA ni les mentions légales (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);

    const reponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/entreprise",
      headers: authHeader(token),
      payload: { tauxTva: 1925 },
    });

    expect(reponse.statusCode).toBe(403);
  });

  it("8.8 : un administrateur configure des jalons d'alerte personnalisés, reflétés dans la liste d'échéance", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const modification = await app.inject({
      method: "PATCH",
      url: "/api/v1/entreprise",
      headers: authHeader(tokenAdmin),
      payload: { jalonAlerteUrgent: 2, jalonAlerteModere: 5, jalonAlerteAnticipe: 10 },
    });
    expect(modification.statusCode).toBe(200);
    expect(modification.json().jalonAlerteAnticipe).toBe(10);

    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Nga", prenom: "Paul", telephone: "690000000" }).returning().get();
    const aujourdHui = new Date();
    const dateFin = new Date(aujourdHui);
    dateFin.setDate(dateFin.getDate() + 10);
    db.insert(schema.abonnement)
      .values({ idAbonne: abonne.idAbonne, idFormule, siteId, dateDebut: aujourdHui.toISOString().slice(0, 10), dateFin: dateFin.toISOString().slice(0, 10), statut: "ACTIF", creePar: userId })
      .run();

    const alertes = await app.inject({ method: "GET", url: `/api/v1/alertes-echeance?siteId=${siteId}`, headers: authHeader(tokenAdmin) });
    expect(alertes.statusCode).toBe(200);
    expect(alertes.json()).toHaveLength(1);
    expect(alertes.json()[0].jalon).toBe(10);
  });

  it("8.8 : rejette des jalons non strictement croissants (400)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const reponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/entreprise",
      headers: authHeader(tokenAdmin),
      payload: { jalonAlerteUrgent: 5, jalonAlerteModere: 3, jalonAlerteAnticipe: 7 },
    });

    expect(reponse.statusCode).toBe(400);
  });
});

describe("Comptes partagés streaming (5.9)", () => {
  it("un administrateur crée un compte partagé, un caissier le liste et recrute un abonné dessus", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");
    const tokenCaissier = await connecter(app);

    const famille = db.insert(schema.familleAbonnement).values({ libelle: "NETFLIX" }).returning().get();
    const formule = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "PREMIUM", prix: 3500, rang: 1 }).returning().get();

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/comptes-partages",
      headers: authHeader(tokenAdmin),
      payload: { siteId, idFamille: famille.idFamille, libelle: "Compte Netflix #1", identifiant: "boutique@example.cm", motDePasse: "secret123", nombreEcransMax: 2 },
    });
    expect(creation.statusCode).toBe(201);
    const idComptePartage = creation.json().idComptePartage;

    const liste = await app.inject({ method: "GET", url: `/api/v1/comptes-partages?siteId=${siteId}`, headers: authHeader(tokenCaissier) });
    expect(liste.statusCode).toBe(200);
    expect(liste.json()[0].ecransOccupes).toBe(0);
    expect(liste.json()[0].motDePasse).toBe("secret123");

    const recrutement = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(tokenCaissier),
      payload: {
        siteId,
        userId,
        aujourdHui: "2025-11-16",
        abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
        idFormule: formule.idFormule,
        montantEncaisse: 3500,
        idComptePartage,
      },
    });
    expect(recrutement.statusCode).toBe(201);

    const fiche = await app.inject({ method: "GET", url: `/api/v1/comptes-partages/${idComptePartage}/fiche`, headers: authHeader(tokenCaissier) });
    expect(fiche.statusCode).toBe(200);
    expect(fiche.json().occupants).toHaveLength(1);
    expect(fiche.json().occupants[0].abonne.nom).toBe("Nga");

    const listeApres = await app.inject({ method: "GET", url: `/api/v1/comptes-partages?siteId=${siteId}`, headers: authHeader(tokenCaissier) });
    expect(listeApres.json()[0].ecransOccupes).toBe(1);
  });

  it("refuse le recrutement une fois la capacité du compte partagé atteinte (400)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "NETFLIX" }).returning().get();
    const formule = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "PREMIUM", prix: 3500, rang: 1 }).returning().get();
    const compte = db
      .insert(schema.comptePartageStreaming)
      .values({ siteId, idFamille: famille.idFamille, libelle: "Compte Netflix #1", nombreEcransMax: 1 })
      .returning()
      .get();

    const premier = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom: "Premier", prenom: "Occupant", telephone: "690000001" }, idFormule: formule.idFormule, montantEncaisse: 3500, idComptePartage: compte.idComptePartage },
    });
    expect(premier.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/recrutements",
      headers: authHeader(token),
      payload: { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom: "Second", prenom: "Occupant", telephone: "690000002" }, idFormule: formule.idFormule, montantEncaisse: 3500, idComptePartage: compte.idComptePartage },
    });
    expect(second.statusCode).toBe(400);
  });

  it("un caissier ne peut pas créer ni modifier de compte partagé (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const token = await connecter(app);
    const famille = db.insert(schema.familleAbonnement).values({ libelle: "NETFLIX" }).returning().get();

    const creation = await app.inject({
      method: "POST",
      url: "/api/v1/comptes-partages",
      headers: authHeader(token),
      payload: { siteId, idFamille: famille.idFamille, libelle: "Compte Netflix #1", nombreEcransMax: 4 },
    });
    expect(creation.statusCode).toBe(403);
  });
});

describe("Sauvegarde et export des données (2.6)", () => {
  let dossierSauvegardes: string;

  beforeEach(() => {
    dossierSauvegardes = mkdtempSync(join(tmpdir(), "mboapilot-test-sauvegarde-"));
  });

  afterEach(() => {
    rmSync(dossierSauvegardes, { recursive: true, force: true });
  });

  it("un administrateur exporte les données (téléchargement) puis retrouve la sauvegarde dans la liste", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST, dossierSauvegardes });
    creerUtilisateur(db, { siteId, nom: "Admin", prenom: "D", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
    const tokenAdmin = await connecter(app, "admin1");

    const export1 = await app.inject({ method: "POST", url: "/api/v1/sauvegarde/export", headers: authHeader(tokenAdmin) });
    expect(export1.statusCode).toBe(200);
    expect(export1.headers["content-disposition"]).toContain("attachment");
    expect(export1.rawPayload.length).toBeGreaterThan(0);

    const liste = await app.inject({ method: "GET", url: "/api/v1/sauvegarde", headers: authHeader(tokenAdmin) });
    expect(liste.statusCode).toBe(200);
    expect(liste.json()).toHaveLength(1);
  });

  it("un caissier ne peut ni exporter ni lister les sauvegardes (403)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST, dossierSauvegardes });
    const token = await connecter(app);

    const export1 = await app.inject({ method: "POST", url: "/api/v1/sauvegarde/export", headers: authHeader(token) });
    expect(export1.statusCode).toBe(403);
    const liste = await app.inject({ method: "GET", url: "/api/v1/sauvegarde", headers: authHeader(token) });
    expect(liste.statusCode).toBe(403);
  });
});
