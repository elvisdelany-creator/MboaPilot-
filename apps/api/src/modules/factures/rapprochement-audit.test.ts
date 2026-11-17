import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";
import { creerPaiement, confirmerRapprochementVirement } from "./paiement.repository.js";
import * as schema from "../../db/schema.js";

// Rapprocher un virement, c'est déclarer l'argent retrouvé sur le relevé de banque : un geste de contrôle financier. Constaté en test des rôles : il ne
// laissait aucune trace (ni qui, ni quand), alors que le journal d'audit doit tracer encaissements et modifications (utilisateur, horodatage, avant/après).
const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";

let db: Db;
let app: FastifyInstance;
let siteId: number;
let comptableId: number;
let idFacture: number;
let idVirement: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  creerUtilisateur(db, { siteId, nom: "Admin", prenom: "Ada", identifiant: "admin1", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" });
  comptableId = creerUtilisateur(db, { siteId, nom: "Compta", prenom: "Carl", identifiant: "comptable1", motDePasse: "motdepasse-secret", role: "COMPTABLE" }).idUser;
  const caissierId = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Paul", identifiant: "caissier1", motDePasse: "motdepasse-secret", role: "CAISSIER" }).idUser;
  const abonne = db.insert(schema.abonne).values({ siteId, nom: "Client", prenom: "Test", telephone: "690000000" }).returning().get();
  idFacture = db.insert(schema.facture).values({ siteId, idAbonne: abonne.idAbonne, creePar: caissierId, montantTotal: 10000 }).returning().get().idFacture;
  idVirement = creerPaiement(db, { idFacture, mode: "VIREMENT", montant: 10000, utilisateurId: caissierId, banque: "Orange Money", referenceVirement: "OM-1" }).idPaiement;
  app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
});

const entetes = async (identifiant: string) => {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse: "motdepasse-secret" } });
  return { authorization: `Bearer ${reponse.json().token as string}` };
};

const lignesAudit = () => db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "paiement")).all();

describe("confirmerRapprochementVirement : le rapprochement est tracé", () => {
  it("écrit une ligne d'audit : qui, avant « en attente », après « rapproché »", () => {
    confirmerRapprochementVirement(db, idVirement, comptableId);

    const lignes = lignesAudit();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ utilisateurId: comptableId, action: "MODIFICATION", tableCible: "paiement", idCible: String(idVirement) });
    expect(JSON.parse(lignes[0].valeurAvant!)).toEqual({ statutRapprochement: "EN_ATTENTE" });
    expect(JSON.parse(lignes[0].valeurApres!)).toEqual({ statutRapprochement: "RAPPROCHE" });
    expect(lignes[0].dateAction).toBeTruthy();
  });

  it("un rapprochement refusé ne laisse aucune ligne : déjà rapproché, paiement inconnu, paiement qui n'est pas un virement", () => {
    confirmerRapprochementVirement(db, idVirement, comptableId);
    const cash = creerPaiement(db, { idFacture, mode: "CASH", montant: 100, utilisateurId: comptableId });

    expect(() => confirmerRapprochementVirement(db, idVirement, comptableId)).toThrow(/déjà rapproché/i);
    expect(() => confirmerRapprochementVirement(db, 999999, comptableId)).toThrow(/introuvable/i);
    expect(() => confirmerRapprochementVirement(db, cash.idPaiement, comptableId)).toThrow(/virement/i);
    expect(lignesAudit()).toHaveLength(1); // celle du premier rapprochement seulement
  });

  it("le paiement et son audit vont ensemble : si l'audit échoue, le virement reste « en attente »", () => {
    expect(() => confirmerRapprochementVirement(db, idVirement, 999999)).toThrow(); // auteur inconnu : la clé étrangère refuse la ligne d'audit

    expect(db.select().from(schema.paiement).where(eq(schema.paiement.idPaiement, idVirement)).get()?.statutRapprochement).toBe("EN_ATTENTE");
    expect(lignesAudit()).toHaveLength(0);
  });
});

describe("PATCH /api/v1/paiements/:id/rapprochement : l'auteur est celui de la session", () => {
  it("le comptable rapproche, et l'administrateur voit son nom dans le journal d'audit", async () => {
    const reponse = await app.inject({ method: "PATCH", url: `/api/v1/paiements/${idVirement}/rapprochement`, headers: await entetes("comptable1") });
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().statutRapprochement).toBe("RAPPROCHE");

    const audit = await app.inject({ method: "GET", url: "/api/v1/audit?tableCible=paiement&limite=20", headers: await entetes("admin1") });
    const ligne = (audit.json() as { tableCible: string; action: string; utilisateurNom: string; utilisateurPrenom: string; valeurApres: string }[]).find((l) => l.action === "MODIFICATION");
    expect(ligne).toMatchObject({ tableCible: "paiement", utilisateurNom: "Compta", utilisateurPrenom: "Carl" });
    expect(ligne?.valeurApres).toContain("RAPPROCHE");
  });

  it("un rapprochement refusé (déjà fait) ne s'ajoute pas au journal", async () => {
    await app.inject({ method: "PATCH", url: `/api/v1/paiements/${idVirement}/rapprochement`, headers: await entetes("comptable1") });
    const second = await app.inject({ method: "PATCH", url: `/api/v1/paiements/${idVirement}/rapprochement`, headers: await entetes("comptable1") });

    expect(second.statusCode).toBe(400);
    expect(lignesAudit()).toHaveLength(1);
  });

  it("le caissier reste refusé (403) et rien n'est écrit", async () => {
    const reponse = await app.inject({ method: "PATCH", url: `/api/v1/paiements/${idVirement}/rapprochement`, headers: await entetes("caissier1") });

    expect(reponse.statusCode).toBe(403);
    expect(lignesAudit()).toHaveLength(0);
  });
});
