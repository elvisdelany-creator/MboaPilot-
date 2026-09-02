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
