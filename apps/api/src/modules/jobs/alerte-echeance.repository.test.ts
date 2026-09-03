import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { listerAlertesEcheance } from "./alerte-echeance.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let autreSiteId: number;
let userId: number;
let idFormule: number;
let idFamille: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  idFamille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  idFormule = db
    .insert(schema.formule)
    .values({ idFamille, libelle: "EVASION", prix: 10500, rang: 2 })
    .returning()
    .get().idFormule;
});

function creerAbonnement(siteCible: number, dateFin: string, statut: "ACTIF" | "EXPIRE" | "RESILIE" = "ACTIF") {
  const abonne = db
    .insert(schema.abonne)
    .values({ siteId: siteCible, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" })
    .returning()
    .get();
  return db
    .insert(schema.abonnement)
    .values({ idAbonne: abonne.idAbonne, idFormule, siteId: siteCible, dateDebut: "2025-10-01", dateFin, statut, creePar: userId })
    .returning()
    .get();
}

describe("listerAlertesEcheance — liste vivante des abonnements à échéance (9.3)", () => {
  it("classe un abonnement à J-7/J-3/J-1 avec les informations jointes, cloisonné par site", () => {
    creerAbonnement(siteId, "2025-10-23"); // J-7 le 2025-10-16
    creerAbonnement(autreSiteId, "2025-10-23"); // autre site, ne doit pas apparaître

    const alertes = listerAlertesEcheance(db, siteId, "2025-10-16");

    expect(alertes).toHaveLength(1);
    expect(alertes[0].jalon).toBe(7);
    expect(alertes[0].rang).toBe(3);
    expect(alertes[0].abonne.nom).toBe("Nga Ndongo");
    expect(alertes[0].abonne.siteId).toBe(siteId);
    expect(alertes[0].formule.idFamille).toBe(idFamille);
  });

  it("un abonnement réabonné (échéance repoussée) disparaît de la liste, même si une alerte a déjà été journalisée", () => {
    const sub = creerAbonnement(siteId, "2025-10-16"); // J-1 le 2025-10-15
    db.insert(schema.alerteEcheance).values({ numeroAbonnement: sub.numeroAbonnement, jalonJours: 1, dateDeclenchement: "2025-10-15" }).run();

    // réabonnement : la date de fin est repoussée
    db.update(schema.abonnement).set({ dateFin: "2025-11-14" }).where(eq(schema.abonnement.numeroAbonnement, sub.numeroAbonnement)).run();

    const alertes = listerAlertesEcheance(db, siteId, "2025-10-15");

    expect(alertes).toHaveLength(0);
  });

  it("ignore un abonnement en dehors de la fenêtre à échéance (plus de 7 jours restants)", () => {
    creerAbonnement(siteId, "2025-10-30");

    const alertes = listerAlertesEcheance(db, siteId, "2025-10-01");

    expect(alertes).toHaveLength(0);
  });

  it("ignore les abonnements déjà expirés ou résiliés", () => {
    creerAbonnement(siteId, "2025-10-10", "EXPIRE");
    creerAbonnement(siteId, "2025-10-10", "RESILIE");

    const alertes = listerAlertesEcheance(db, siteId, "2025-10-08");

    expect(alertes).toHaveLength(0);
  });

  it("trie par urgence, l'échéance la plus proche en premier", () => {
    creerAbonnement(siteId, "2025-10-23"); // 7 jours
    creerAbonnement(siteId, "2025-10-17"); // 1 jour

    const alertes = listerAlertesEcheance(db, siteId, "2025-10-16");

    expect(alertes.map((a) => a.jalon)).toEqual([1, 7]);
  });

  it("8.8 : respecte des jalons personnalisés configurés sur le site", () => {
    db.update(schema.entreprise).set({ jalonAlerteUrgent: 2, jalonAlerteModere: 5, jalonAlerteAnticipe: 10 }).run();
    creerAbonnement(siteId, "2025-10-26"); // 10 jours restants au 2025-10-16

    const alertes = listerAlertesEcheance(db, siteId, "2025-10-16");

    expect(alertes).toHaveLength(1);
    expect(alertes[0].jalon).toBe(10);
    expect(alertes[0].rang).toBe(3);
  });
});
