import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { executerJobQuotidien } from "./job-quotidien.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;
let idFamilleCanal: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  idFamilleCanal = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  idFormule = db
    .insert(schema.formule)
    .values({ idFamille: idFamilleCanal, libelle: "EVASION", prix: 10500, rang: 2 })
    .returning()
    .get().idFormule;
});

function creerAbonne(telephone: string) {
  return db.insert(schema.abonne).values({ siteId, nom: "N", prenom: "P", telephone }).returning().get();
}

function creerAbonnement(idAbonne: number, dateDebut: string, dateFin: string, statut: "ACTIF" | "EXPIRE" | "RESILIE" = "ACTIF") {
  return db
    .insert(schema.abonnement)
    .values({ idAbonne, idFormule, siteId, dateDebut, dateFin, statut, creePar: userId })
    .returning()
    .get();
}

describe("executerJobQuotidien — expiration (4.3)", () => {
  it("bascule un abonnement ACTIF expiré en EXPIRE et trace l'historique sans utilisateur (job automatique)", () => {
    const abonne = creerAbonne("690000001");
    const sub = creerAbonnement(abonne.idAbonne, "2025-10-01", "2025-10-30");

    const resultat = executerJobQuotidien(db, "2025-10-31");

    const misAJour = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, sub.numeroAbonnement)).get();
    expect(misAJour?.statut).toBe("EXPIRE");
    expect(resultat.abonnementsExpires).toBe(1);

    const histo = db
      .select()
      .from(schema.historiqueAbonnement)
      .where(eq(schema.historiqueAbonnement.numeroAbonnement, sub.numeroAbonnement))
      .all();
    expect(histo).toHaveLength(1);
    expect(histo[0].typeChangement).toBe("STATUT");
    expect(histo[0].valeurAvant).toBe("ACTIF");
    expect(histo[0].valeurApres).toBe("EXPIRE");
    expect(histo[0].utilisateurId).toBeNull();
  });

  it("ne touche pas un abonnement encore valide le dernier jour inclus", () => {
    const abonne = creerAbonne("690000002");
    const sub = creerAbonnement(abonne.idAbonne, "2025-10-01", "2025-10-30");

    executerJobQuotidien(db, "2025-10-30");

    const inchange = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, sub.numeroAbonnement)).get();
    expect(inchange?.statut).toBe("ACTIF");
  });
});

describe("executerJobQuotidien — alertes J-7/J-3/J-1 (4.4)", () => {
  it("crée une alerte J-7 pour un abonnement à échéance dans 7 jours", () => {
    const abonne = creerAbonne("690000003");
    const sub = creerAbonnement(abonne.idAbonne, "2025-10-01", "2025-10-30");

    const resultat = executerJobQuotidien(db, "2025-10-23");

    expect(resultat.alertesCreees).toBe(1);
    const alertes = db
      .select()
      .from(schema.alerteEcheance)
      .where(eq(schema.alerteEcheance.numeroAbonnement, sub.numeroAbonnement))
      .all();
    expect(alertes).toHaveLength(1);
    expect(alertes[0].jalonJours).toBe(7);
    expect(alertes[0].dateDeclenchement).toBe("2025-10-23");
  });

  it("ne duplique pas l'alerte si le job tourne deux fois le même jour", () => {
    const abonne = creerAbonne("690000004");
    creerAbonnement(abonne.idAbonne, "2025-10-01", "2025-10-30");

    executerJobQuotidien(db, "2025-10-27"); // J-3
    const resultat2 = executerJobQuotidien(db, "2025-10-27");

    expect(resultat2.alertesCreees).toBe(0);
    const alertes = db.select().from(schema.alerteEcheance).all();
    expect(alertes).toHaveLength(1);
  });

  it("ne crée pas d'alerte en dehors de J-7/J-3/J-1", () => {
    const abonne = creerAbonne("690000005");
    creerAbonnement(abonne.idAbonne, "2025-10-01", "2025-10-30");

    const resultat = executerJobQuotidien(db, "2025-10-15");

    expect(resultat.alertesCreees).toBe(0);
  });

  it("8.8 : respecte des jalons personnalisés configurés sur l'entreprise", () => {
    db.update(schema.entreprise).set({ jalonAlerteUrgent: 2, jalonAlerteModere: 5, jalonAlerteAnticipe: 10 }).run();
    const abonne = creerAbonne("690000009");
    const sub = creerAbonnement(abonne.idAbonne, "2025-10-01", "2025-10-30");

    // J-7 n'est plus un seuil configuré : aucune alerte
    const resultatJ7 = executerJobQuotidien(db, "2025-10-23");
    expect(resultatJ7.alertesCreees).toBe(0);

    // J-10 (nouveau seuil "anticipé") déclenche bien une alerte
    const resultatJ10 = executerJobQuotidien(db, "2025-10-20");
    expect(resultatJ10.alertesCreees).toBe(1);
    const alertes = db.select().from(schema.alerteEcheance).where(eq(schema.alerteEcheance.numeroAbonnement, sub.numeroAbonnement)).all();
    expect(alertes[0].jalonJours).toBe(10);
  });
});

describe("executerJobQuotidien — suivi commission CANAL+ (6.2)", () => {
  function creerSuivi(numeroAbonnement: number, dateFinProbatoire: string) {
    return db
      .insert(schema.suiviCommissionCanalplus)
      .values({ numeroAbonnement, vendeurId: userId, montantCommission: 5000, dateFinProbatoire })
      .returning()
      .get();
  }

  it("annule la commission si l'abonnement expire pendant la période probatoire", () => {
    const abonne = creerAbonne("690000006");
    const sub = creerAbonnement(abonne.idAbonne, "2025-09-01", "2025-09-30"); // déjà expiré au 1er oct.
    const suivi = creerSuivi(sub.numeroAbonnement, "2026-01-01");

    const resultat = executerJobQuotidien(db, "2025-10-01");

    const misAJour = db.select().from(schema.suiviCommissionCanalplus).where(eq(schema.suiviCommissionCanalplus.idSuivi, suivi.idSuivi)).get();
    expect(misAJour?.statut).toBe("ANNULEE");
    expect(resultat.commissionsAnnulees).toBe(1);
  });

  it("confirme la commission une fois la période probatoire dépassée sans expiration", () => {
    const abonne = creerAbonne("690000007");
    const sub = creerAbonnement(abonne.idAbonne, "2025-11-01", "2026-06-01"); // large fenêtre, reste ACTIF
    const suivi = creerSuivi(sub.numeroAbonnement, "2026-01-01");

    const resultat = executerJobQuotidien(db, "2026-01-02");

    const misAJour = db.select().from(schema.suiviCommissionCanalplus).where(eq(schema.suiviCommissionCanalplus.idSuivi, suivi.idSuivi)).get();
    expect(misAJour?.statut).toBe("CONFIRMEE");
    expect(resultat.commissionsConfirmees).toBe(1);
  });
});
