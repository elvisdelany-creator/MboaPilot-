import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";
import * as schema from "../../db/schema.js";
import type { FournisseurPaiementMobile } from "./fournisseur.js";

// Le seul « opérateur » branché aujourd'hui est un SIMULATEUR : il confirme tout paiement au bout de quelques secondes, que le client ait payé
// ou non. Dans une vraie boutique, ce mode ne doit donc ni apparaître à la caisse ni être accepté par le serveur, sauf choix explicite.
const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";

class FournisseurFactice implements FournisseurPaiementMobile {
  async initier() {
    return { referenceFournisseur: "REF-TEST" };
  }
  async consulterStatut() {
    return "EN_ATTENTE" as const;
  }
}

let db: Db;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Paul", identifiant: "caissier1", motDePasse: "motdepasse-secret", role: "CAISSIER" });
});

async function entetes(app: FastifyInstance) {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "caissier1", motDePasse: "motdepasse-secret" } });
  return { authorization: `Bearer ${reponse.json().token as string}` };
}

const disponible = async (app: FastifyInstance) => (await app.inject({ method: "GET", url: "/api/v1/paiement-mobile/disponibilite", headers: await entetes(app) })).json().disponible;

const initier = async (app: FastifyInstance) =>
  app.inject({ method: "POST", url: "/api/v1/paiements-mobiles", headers: await entetes(app), payload: { idFacture: 1, numeroTelephone: "690000000", montant: 1000, parcours: "USSD_CLIENT" } });

const nombreTransactions = () => db.select().from(schema.transactionMobileMoney).all().length;

describe("disponibilité du paiement Mobile Money", () => {
  it("n'est pas disponible par défaut : aucun opérateur réel n'est branché", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    expect(await disponible(app)).toBe(false);
  });

  it("refuse (403) d'initier un paiement Mobile Money quand il n'est pas disponible, sans rien enregistrer", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await initier(app);

    expect(reponse.statusCode).toBe(403);
    expect(reponse.json().erreur).toMatch(/Mobile Money.*pas disponible/i);
    expect(reponse.json().erreur).toMatch(/virement/i); // dit quoi faire à la place
    expect(nombreTransactions()).toBe(0);
  });

  it("est disponible en démo publique (le simulateur y sert à montrer le parcours)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST, modeDemo: true });

    expect(await disponible(app)).toBe(true);
  });

  it("est disponible quand un fournisseur est branché explicitement", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST, fournisseurPaiementMobile: new FournisseurFactice() });

    expect(await disponible(app)).toBe(true);
  });

  it("peut être activé ou coupé explicitement, quel que soit le reste", async () => {
    expect(await disponible(buildApp(db, { jwtSecret: JWT_SECRET_TEST, mobileMoneyActif: true }))).toBe(true);
    expect(await disponible(buildApp(db, { jwtSecret: JWT_SECRET_TEST, modeDemo: true, mobileMoneyActif: false }))).toBe(false);
    expect(await disponible(buildApp(db, { jwtSecret: JWT_SECRET_TEST, fournisseurPaiementMobile: new FournisseurFactice(), mobileMoneyActif: false }))).toBe(false);
  });

  it("la route de disponibilité exige d'être connecté", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({ method: "GET", url: "/api/v1/paiement-mobile/disponibilite" });

    expect(reponse.statusCode).toBe(401);
  });
});
