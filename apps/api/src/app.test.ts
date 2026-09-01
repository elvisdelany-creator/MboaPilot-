import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
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
