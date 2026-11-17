import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";
import { construireFicheApporteur, ficheVisibleParApporteur } from "./apporteur.service.js";
import * as schema from "../../db/schema.js";

// Un apporteur est un partenaire EXTERNE : il consulte ses clients et ses commissions, pas leurs pièces d'identité. Constaté en test des rôles : sa fiche
// renvoyait les abonnés en entier (n° de CNI, adresse, e-mail), alors que l'écran n'en montre que le nom et le téléphone.
const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";
const CNI = "CNI-123456789-SECRET";
const ADRESSE = "12 rue des Manguiers, Bonapriso";
const EMAIL = "marie.essomba@exemple.cm";

let db: Db;
let app: FastifyInstance;
let siteId: number;
let idApporteur: number;
let autreApporteur: number;
let userGerant: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userGerant = creerUtilisateur(db, { siteId, nom: "Mbia", prenom: "Luc", identifiant: "gerant1", motDePasse: "motdepasse-secret", role: "GERANT" }).idUser;
  idApporteur = db.insert(schema.sousDistributeur).values({ nom: "Jean-Claude Mbarga", telephone: "600000090", tauxCommissionDefaut: 100 }).returning().get().idApporteur;
  autreApporteur = db.insert(schema.sousDistributeur).values({ nom: "Sandrine Tchoua", telephone: "600000091", tauxCommissionDefaut: 150 }).returning().get().idApporteur;
  creerUtilisateur(db, { siteId, nom: "Admin", prenom: "Ada", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
  creerUtilisateur(db, { siteId, nom: "Mbarga", prenom: "Jean-Claude", identifiant: "apporteur1", motDePasse: "motdepasse-secret", role: "APPORTEUR", idApporteur });

  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  const formule = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get();
  const abonne = db
    .insert(schema.abonne)
    .values({ siteId, nom: "Essomba", prenom: "Marie", telephone: "677000001", numeroCni: CNI, adresse: ADRESSE, email: EMAIL, apporteurId: idApporteur })
    .returning()
    .get();
  const numero = db
    .insert(schema.abonnement)
    .values({ idAbonne: abonne.idAbonne, idFormule: formule.idFormule, siteId, dateDebut: "2026-10-01", dateFin: "2026-10-30", statut: "ACTIF", creePar: userGerant })
    .returning()
    .get().numeroAbonnement;
  db.insert(schema.facture).values({ siteId, idAbonne: abonne.idAbonne, creePar: userGerant, montantTotal: 10500, statut: "VALIDEE" }).run();
  db.insert(schema.suiviCommissionCanalplus).values({ numeroAbonnement: numero, vendeurId: userGerant, apporteurId: idApporteur, montantCommission: 1050, dateFinProbatoire: "2027-02-01", statut: "CONFIRMEE" }).run();
  db.insert(schema.reglementCommission).values({ apporteurId: idApporteur, montant: 500, modePaiement: "VIREMENT", reference: "VIR-77", utilisateurId: userGerant }).run();
  // un client d'un autre apporteur : ne doit jamais apparaître
  db.insert(schema.abonne).values({ siteId, nom: "Autre", prenom: "Client", telephone: "677000002", numeroCni: "CNI-AUTRE", apporteurId: autreApporteur }).run();
  app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
});

const entetes = async (identifiant: string) => {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse: "motdepasse-secret" } });
  return { authorization: `Bearer ${reponse.json().token as string}` };
};

describe("fiche d'un apporteur vue par l'apporteur lui-même", () => {
  it("ses clients ne portent que ce que l'écran montre : identifiant, prénom, nom, téléphone", async () => {
    const reponse = await app.inject({ method: "GET", url: `/api/v1/apporteurs/${idApporteur}/fiche`, headers: await entetes("apporteur1") });

    expect(reponse.statusCode).toBe(200);
    const abonnes = reponse.json().abonnes as Record<string, unknown>[];
    expect(abonnes).toHaveLength(1);
    expect(Object.keys(abonnes[0]).sort()).toEqual(["idAbonne", "nom", "prenom", "telephone"]);
    expect(abonnes[0]).toMatchObject({ prenom: "Marie", nom: "Essomba", telephone: "677000001" });
  });

  it("nulle part dans la réponse : ni n° de CNI, ni adresse, ni e-mail, ni client d'un autre apporteur", async () => {
    const reponse = await app.inject({ method: "GET", url: `/api/v1/apporteurs/${idApporteur}/fiche`, headers: await entetes("apporteur1") });

    for (const secret of [CNI, ADRESSE, EMAIL, "CNI-AUTRE", "677000002"]) expect(reponse.body).not.toContain(secret);
  });

  it("ses commissions et ses règlements ne portent pas d'identifiants internes du personnel de la boutique", async () => {
    const fiche = (await app.inject({ method: "GET", url: `/api/v1/apporteurs/${idApporteur}/fiche`, headers: await entetes("apporteur1") })).json();

    expect(Object.keys(fiche.commissionsCanalplus[0]).sort()).toEqual(["dateFinProbatoire", "idSuivi", "montantCommission", "numeroAbonnement", "statut"]);
    expect(Object.keys(fiche.reglements[0]).sort()).toEqual(["dateReglement", "idReglement", "modePaiement", "montant", "reference"]);
  });

  it("les montants ne changent pas : chiffre d'affaires, commissions confirmées, réglées et solde dû (comparés à la vue complète de l'administrateur)", async () => {
    const restreinte = (await app.inject({ method: "GET", url: `/api/v1/apporteurs/${idApporteur}/fiche`, headers: await entetes("apporteur1") })).json();
    const complete = (await app.inject({ method: "GET", url: `/api/v1/apporteurs/${idApporteur}/fiche`, headers: await entetes("admin1") })).json();

    for (const cle of ["chiffreAffaires", "montantCommissionConfirmee", "montantCommissionRegle", "soldeCommissionDu"]) expect(restreinte[cle]).toBe(complete[cle]);
    expect(restreinte.soldeCommissionDu).toBe(550);
    expect(restreinte.apporteur.nom).toBe("Jean-Claude Mbarga");
  });

  it("le personnel de la boutique, lui, garde la fiche complète des clients (nom, CNI, adresse, e-mail)", async () => {
    const fiche = (await app.inject({ method: "GET", url: `/api/v1/apporteurs/${idApporteur}/fiche`, headers: await entetes("gerant1") })).json();

    expect(fiche.abonnes[0]).toMatchObject({ numeroCni: CNI, adresse: ADRESSE, email: EMAIL });
    expect(fiche.commissionsCanalplus[0].vendeurId).toBe(userGerant);
  });
});

describe("ficheVisibleParApporteur", () => {
  it("réduit une fiche complète sans modifier l'originale", () => {
    const complete = construireFicheApporteur(db, idApporteur);
    const restreinte = ficheVisibleParApporteur(complete);

    expect(restreinte.abonnes[0]).not.toHaveProperty("numeroCni");
    expect(complete.abonnes[0]).toHaveProperty("numeroCni", CNI);
  });
});
