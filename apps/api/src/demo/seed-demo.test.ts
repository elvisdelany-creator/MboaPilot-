import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { jourDouala } from "@mboapilot/shared";
import { creerDbTest, type Db } from "../test-utils/db.js";
import * as schema from "../db/schema.js";
import { authentifier } from "../modules/auth/auth.service.js";
import { calculerEtatLicence } from "../modules/licence/licence.service.js";
import { listerAlertesEcheance, listerAbonnementsExpires } from "../modules/jobs/alerte-echeance.repository.js";
import { listerAlertesStock } from "../modules/stock/stock.service.js";
import { obtenirClotureOuverte } from "../modules/caisse/cloture-caisse.service.js";
import { calculerEvolutionCA, calculerIndicateursJour } from "../modules/tableau-bord/tableau-bord.service.js";
import { COMPTES_DEMO } from "./mode-demo.js";
import { peuplerDemo } from "./seed-demo.js";

// la démo est le premier contact d'un prospect avec MboaPilot : elle doit montrer des écrans vivants (alertes, stock bas, SAV à plusieurs
// stades, historique de ventes), pas une boutique vide
let db: Db;
let siteId: number;

beforeEach(() => {
  db = creerDbTest();
  siteId = peuplerDemo(db).siteId;
});

describe("peuplerDemo", () => {
  it("crée les trois comptes de démo, qui se connectent avec les identifiants affichés à l'écran", () => {
    for (const c of COMPTES_DEMO) {
      const u = authentifier(db, c.identifiant, c.motDePasse);
      expect(u.role).toBe(c.role);
      expect(u.siteId).toBe(siteId);
    }
    expect(db.select().from(schema.utilisateur).all()).toHaveLength(COMPTES_DEMO.length);
  });

  it("charge un catalogue d'abonnements réaliste (plusieurs opérateurs, formules et kits)", () => {
    expect(db.select().from(schema.familleAbonnement).all().length).toBeGreaterThanOrEqual(3);
    expect(db.select().from(schema.formule).all().length).toBeGreaterThanOrEqual(10);
    expect(db.select().from(schema.kit).all().length).toBeGreaterThanOrEqual(2);
  });

  it("propose des articles et services, dont au moins un en alerte de stock", () => {
    const produits = db.select().from(schema.produit).all();
    expect(produits.filter((p) => p.type === "BIEN").length).toBeGreaterThanOrEqual(5);
    expect(produits.filter((p) => p.type === "SERVICE").length).toBeGreaterThanOrEqual(1);
    expect(listerAlertesStock(db, siteId).length).toBeGreaterThanOrEqual(1);
  });

  it("a des clients avec des abonnements à toutes les étapes : à échéance proche, expirés, en cours", () => {
    const aujourdHui = jourDouala();
    expect(db.select().from(schema.abonne).all().length).toBeGreaterThanOrEqual(12);
    const statuts = new Set(db.select().from(schema.abonnement).all().map((a) => a.statut));
    expect(statuts.has("ACTIF")).toBe(true);
    // les listes du tableau de bord ne sont pas vides, et les dates sont relatives à aujourd'hui (la démo reste crédible chaque jour)
    expect(listerAlertesEcheance(db, siteId, aujourdHui).length).toBeGreaterThanOrEqual(3);
    expect(listerAbonnementsExpires(db, siteId, aujourdHui).length).toBeGreaterThanOrEqual(2);
  });

  it("rattache des clients à des apporteurs d'affaires", () => {
    expect(db.select().from(schema.sousDistributeur).all().length).toBeGreaterThanOrEqual(2);
    expect(db.select().from(schema.abonne).all().some((a) => a.apporteurId !== null)).toBe(true);
  });

  it("montre un historique de ventes réparti sur plusieurs jours, et un chiffre d'affaires aujourd'hui", () => {
    const aujourdHui = jourDouala();
    const evolution = calculerEvolutionCA(db, siteId, aujourdHui, 7);
    expect(evolution.filter((j) => j.montant > 0).length).toBeGreaterThanOrEqual(4);
    expect(calculerIndicateursJour(db, siteId, aujourdHui).chiffreAffairesJour).toBeGreaterThan(0);
  });

  it("a des dossiers SAV à plusieurs stades, dont un prêt à récupérer avec sa facture", () => {
    const dossiers = db.select().from(schema.savDossier).all();
    expect(dossiers.length).toBeGreaterThanOrEqual(4);
    expect(new Set(dossiers.map((d) => d.statut)).size).toBeGreaterThanOrEqual(3);
    const pret = dossiers.find((d) => d.statut === "PRET");
    expect(pret?.idFacture).toBeTruthy();
  });

  it("a une caisse déjà ouverte, pour que le caissier puisse vendre tout de suite", () => {
    expect(obtenirClotureOuverte(db, siteId)).toBeTruthy();
  });

  it("a une licence active, dont l'abonnement court bien au-delà de la durée d'une démo", () => {
    const licence = db.select().from(schema.licence).get()!;
    expect(calculerEtatLicence(licence, new Date().toISOString()).etat).toBe("ACTIVE");
    const dansCinqAns = new Date(Date.now() + 5 * 365 * 86400000).toISOString().slice(0, 10);
    expect(licence.dateExpirationAbonnement > dansCinqAns).toBe(true);
  });

  it("ne laisse aucune incohérence comptable : chaque facture validée est soldée par ses paiements ou a un client à qui réclamer le solde", () => {
    const orphelines = db.all<{ n: number }>(sql`
      select count(*) n from facture f
      where f.statut = 'VALIDEE' and f.type = 'VENTE' and f.id_abonne is null
        and f.montant_total > coalesce((select sum(p.montant) from paiement p where p.id_facture = f.id_facture), 0)`);
    expect(orphelines[0].n).toBe(0);
  });
});
