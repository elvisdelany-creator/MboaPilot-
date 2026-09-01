import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

let db: BetterSQLite3Database<typeof schema>;
let rawSqlite: Database.Database;

beforeEach(() => {
  rawSqlite = new Database(":memory:");
  rawSqlite.pragma("journal_mode = WAL");
  rawSqlite.pragma("foreign_keys = ON");
  db = drizzle(rawSqlite, { schema });
  migrate(db, { migrationsFolder: "./src/db/migrations" });
});

describe("schéma MboaPilot", () => {
  it("applique les clés étrangères (2.4 : jamais d'écriture orpheline)", () => {
    expect(() =>
      rawSqlite.prepare("INSERT INTO site (id_entreprise, nom) VALUES (999, 'Site fantome')").run()
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("chaîne entreprise -> site -> utilisateur -> abonné -> abonnement (3.2)", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const s = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site principal" }).returning().get();
    const u = db
      .insert(schema.utilisateur)
      .values({
        siteId: s.idSite,
        nom: "Nga Ndongo",
        prenom: "Valentin",
        identifiant: "vnga",
        motDePasseHash: "hash",
        role: "CAISSIER",
      })
      .returning()
      .get();
    const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
    const f = db
      .insert(schema.formule)
      .values({ idFamille: fam.idFamille, libelle: "TOUT CANAL+", prix: 28000, rang: 4, dureeCycles: 1 })
      .returning()
      .get();
    const ab = db
      .insert(schema.abonne)
      .values({ siteId: s.idSite, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" })
      .returning()
      .get();

    // exemple de référence 4.2 : début 16/11/2025, 1 cycle de 30j -> fin 15/12/2025
    const sub = db
      .insert(schema.abonnement)
      .values({
        idAbonne: ab.idAbonne,
        idFormule: f.idFormule,
        siteId: s.idSite,
        dateDebut: "2025-11-16",
        dateFin: "2025-12-15",
        creePar: u.idUser,
      })
      .returning()
      .get();

    expect(sub.statut).toBe("ACTIF");
    expect(sub.dateFin).toBe("2025-12-15");
  });

  it("interdit deux paiements avec la même référence de transaction (idempotence 13.2)", () => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const s = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site" }).returning().get();
    const u = db
      .insert(schema.utilisateur)
      .values({ siteId: s.idSite, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
      .returning()
      .get();
    const fac = db.insert(schema.facture).values({ siteId: s.idSite, creePar: u.idUser }).returning().get();

    db.insert(schema.paiement)
      .values({ idFacture: fac.idFacture, mode: "MOBILE_MONEY", montant: 5000, referenceTransaction: "OM-TXN-1" })
      .run();

    expect(() =>
      db
        .insert(schema.paiement)
        .values({ idFacture: fac.idFacture, mode: "MOBILE_MONEY", montant: 5000, referenceTransaction: "OM-TXN-1" })
        .run()
    ).toThrow(/UNIQUE constraint failed/);
  });
});
