import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerAbonne, trouverAbonne } from "./abonne.repository.js";
import { recruterAbonne } from "../abonnements/recrutement.service.js";
import { anonymiserAbonne } from "./anonymisation.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" })
    .returning()
    .get().idUser;
  const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  idFormule = db.insert(schema.formule).values({ idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
});

// 11.3 : droit de suppression — outil technique, la conformité précise
// (durée de conservation, base légale) reste à valider juridiquement (11.3).
describe("anonymiserAbonne (11.3)", () => {
  it("efface l'identité et les coordonnées, sans supprimer la fiche ni son historique transactionnel", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000", email: "v@example.cm", numeroCni: "CM123", adresse: "Douala" });
    const { numeroAbonnement, idFacture } = recruterAbonne(db, { siteId, userId, aujourdHui: "2025-11-16", abonne: { idAbonne: abonne.idAbonne }, idFormule, montantEncaisse: 10500 });

    const resultat = anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });

    expect(resultat.nom).not.toBe("Nga Ndongo");
    expect(resultat.prenom).not.toBe("Valentin");
    expect(resultat.telephone).not.toBe("690000000");
    expect(resultat.email).toBeNull();
    expect(resultat.numeroCni).toBeNull();
    expect(resultat.adresse).toBeNull();
    expect(resultat.idAbonne).toBe(abonne.idAbonne);

    // la fiche et son historique transactionnel restent intacts (obligations comptables, 11.3)
    expect(trouverAbonne(db, abonne.idAbonne)).toBeDefined();
    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get();
    expect(abonnement?.idAbonne).toBe(abonne.idAbonne);
    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
    expect(facture?.idAbonne).toBe(abonne.idAbonne);
  });

  it("journalise l'anonymisation dans le journal d'audit (immuable), avec l'identité d'origine", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });

    anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });

    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "abonne")).all();
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("SUPPRESSION");
    expect(audit[0].idCible).toBe(String(abonne.idAbonne));
    expect(audit[0].utilisateurId).toBe(userId);
    expect(audit[0].valeurAvant).toContain("Nga Ndongo");
  });

  it("rejette un abonné inconnu", () => {
    expect(() => anonymiserAbonne(db, { idAbonne: 999999, userId })).toThrow(/introuvable/);
  });

  it("est idempotent — anonymiser une fiche déjà anonymisée ne renvoie pas d'erreur", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });

    anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });
    const deuxiemeAppel = anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });

    expect(deuxiemeAppel.email).toBeNull();
  });

  // 11.3 : anonymisation automatique déclenchée par le job quotidien —
  // aucun utilisateur humain à l'origine de l'action
  it("sans userId (job automatique), journalise avec utilisateur_id NULL", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });

    anonymiserAbonne(db, { idAbonne: abonne.idAbonne });

    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "abonne")).all();
    expect(audit).toHaveLength(1);
    expect(audit[0].utilisateurId).toBeNull();
  });
});
