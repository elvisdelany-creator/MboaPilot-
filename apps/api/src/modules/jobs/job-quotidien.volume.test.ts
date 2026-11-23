import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { decalerJour } from "@mboapilot/shared";
import type { Db } from "../../test-utils/db.js";
import { executerJobQuotidien } from "./job-quotidien.service.js";
import * as schema from "../../db/schema.js";

// Constaté en test de charge (40 000 abonnements actifs) : le job quotidien tourne d'un seul bloc dans le serveur de la caisse. Chaque
// expiration s'écrivait seule (3 260 expirations d'un coup : 4,5 à 5,5 s sans que la caisse réponde), et chaque jour les 40 000 abonnements
// étaient tous lus alors que seuls quelques dizaines sont à expirer ou à relancer (0,4 s de gel quotidien).
// base sur un FICHIER (comme la vraie caisse, en mode WAL) : en mémoire, les écritures ne coûtent rien et masqueraient le problème mesuré
let db: Db;
let dossierTemporaire: string;
let siteId: number;
let idFormule: number;
let userId: number;
const AUJOURDHUI = "2028-06-01";

beforeEach(() => {
  dossierTemporaire = mkdtempSync(join(tmpdir(), "mboapilot-job-volume-"));
  const sqlite = new Database(join(dossierTemporaire, "test.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  idFormule = db.insert(schema.formule).values({ idFamille: famille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
});

afterEach(() => {
  db.$client.close();
  rmSync(dossierTemporaire, { recursive: true, force: true });
});

function creerAbonne(nom: string, telephone = "") {
  return db.insert(schema.abonne).values({ siteId, nom, prenom: "P", telephone }).returning().get().idAbonne;
}

// insertion en masse (SQL direct dans une transaction) : des milliers de lignes sans payer l'ORM à chaque ligne
function insererAbonnements(idAbonne: number, dateFin: string, nombre: number, statut: "ACTIF" | "EXPIRE" = "ACTIF") {
  const sql = db.$client;
  const ins = sql.prepare("INSERT INTO abonnement (id_abonne, id_formule, site_id, date_debut, date_fin, statut, cree_par) VALUES (?, ?, ?, ?, ?, ?, ?)");
  sql.transaction(() => {
    for (let i = 0; i < nombre; i++) ins.run(idAbonne, idFormule, siteId, decalerJour(dateFin, -30), dateFin, statut, userId);
  })();
}

// La durée se mesure contre une référence prise sur la même machine au même moment : un seuil en millisecondes dépendrait de la charge
// (la suite complète lance une centaine de fichiers de tests en parallèle).
// Coût de la lecture de tous les abonnements actifs (ce que faisait le job chaque jour avant de ne lire que les concernés)
function dureeLecturePleine(): number {
  const debut = performance.now();
  db.select().from(schema.abonnement).where(eq(schema.abonnement.statut, "ACTIF")).all();
  return performance.now() - debut;
}

const statuts = () => db.$client.prepare("SELECT statut, count(*) AS n FROM abonnement GROUP BY statut ORDER BY statut").all() as { statut: string; n: number }[];

describe("executerJobQuotidien : tout ou rien pour les expirations", () => {
  it("si l'écriture d'une expiration échoue, aucun abonnement n'est expiré à moitié, et le job suivant les expire tous", () => {
    const abonne = creerAbonne("Client");
    insererAbonnements(abonne, "2028-05-01", 10);
    // la 7e expiration échoue (trace d'historique refusée) : un panne d'écriture au milieu du lot
    db.$client.exec(`CREATE TRIGGER panne_historique BEFORE INSERT ON historique_abonnement WHEN NEW.numero_abonnement = 7 BEGIN SELECT RAISE(ABORT, 'panne simulée'); END;`);

    expect(() => executerJobQuotidien(db, AUJOURDHUI)).toThrow(/panne simulée/);
    expect(statuts()).toEqual([{ statut: "ACTIF", n: 10 }]);
    expect(db.select().from(schema.historiqueAbonnement).all()).toHaveLength(0);

    db.$client.exec("DROP TRIGGER panne_historique");
    const resultat = executerJobQuotidien(db, AUJOURDHUI);
    expect(resultat.abonnementsExpires).toBe(10);
    expect(statuts()).toEqual([{ statut: "EXPIRE", n: 10 }]);
    expect(db.select().from(schema.historiqueAbonnement).all()).toHaveLength(10);
  });
});

describe("executerJobQuotidien : volume", () => {
  it("3 000 expirations d'un coup parmi 20 000 abonnements actifs : le résultat est exact, sans toucher aux autres", () => {
    const abonne = creerAbonne("Client");
    insererAbonnements(abonne, "2028-05-01", 3_000); // à expirer
    insererAbonnements(abonne, "2029-01-01", 20_000); // loin devant eux : ni expiration ni relance

    const resultat = executerJobQuotidien(db, AUJOURDHUI);


    expect(resultat).toMatchObject({ abonnementsExpires: 3_000, alertesCreees: 0, notificationsTentees: 0 });
    expect(statuts()).toEqual([
      { statut: "ACTIF", n: 20_000 },
      { statut: "EXPIRE", n: 3_000 },
    ]);
    expect(db.select().from(schema.historiqueAbonnement).all()).toHaveLength(3_000);
    // la rapidité du lot (2,4 s avant, 0,6 s après, sur fichier) est constatée à la mesure : un seuil de durée y serait trop dépendant du disque. Ce qui
    // la garantit ici est le tout-ou-rien du test précédent (un seul lot) : des écritures validées une à une ne pourraient pas être annulées ensemble.
  });

  it("le job courant, 30 000 abonnements actifs dont quelques-uns à relancer : rapide, et les bonnes alertes", () => {
    const abonne = creerAbonne("Client", "670000001");
    insererAbonnements(abonne, "2029-01-01", 30_000);
    insererAbonnements(abonne, decalerJour(AUJOURDHUI, 3), 5); // J-3
    insererAbonnements(abonne, decalerJour(AUJOURDHUI, 1), 4); // J-1
    insererAbonnements(abonne, decalerJour(AUJOURDHUI, 7), 3); // J-7

    const lecturePleine = dureeLecturePleine();
    const debut = performance.now();
    const resultat = executerJobQuotidien(db, AUJOURDHUI);
    const duree = performance.now() - debut;


    expect(resultat).toMatchObject({ abonnementsExpires: 0, alertesCreees: 12, notificationsTentees: 12 });
    // avant : le job relisait les 30 000 abonnements (durée au moins égale à cette lecture) ; après : seuls les 12 concernés
    expect(duree, `durée du job : ${Math.round(duree)} ms, lecture de tous les abonnements : ${Math.round(lecturePleine)} ms`).toBeLessThan(lecturePleine * 0.5);
    // rejouer le même jour ne fait rien de plus
    expect(executerJobQuotidien(db, AUJOURDHUI)).toMatchObject({ abonnementsExpires: 0, alertesCreees: 0, notificationsTentees: 0 });
  });

  it("ne lit que la fenêtre utile : un abonnement juste au-delà du jalon le plus anticipé n'est pas relancé, celui sur le jalon l'est", () => {
    const abonne = creerAbonne("Client", "670000001");
    const sur = decalerJour(AUJOURDHUI, 7);
    const apres = decalerJour(AUJOURDHUI, 8);
    insererAbonnements(abonne, sur, 1);
    insererAbonnements(abonne, apres, 1);
    insererAbonnements(abonne, AUJOURDHUI, 1); // dernier jour : encore actif, palier le plus urgent

    const resultat = executerJobQuotidien(db, AUJOURDHUI);

    expect(resultat).toMatchObject({ abonnementsExpires: 0, alertesCreees: 2 });
    const alertes = db.select().from(schema.alerteEcheance).all().map((a) => [a.numeroAbonnement, a.jalonJours]);
    expect(alertes).toEqual([[1, 7], [3, 1]]);
    expect(db.select().from(schema.abonnement).where(eq(schema.abonnement.statut, "ACTIF")).all()).toHaveLength(3);
  });
});
