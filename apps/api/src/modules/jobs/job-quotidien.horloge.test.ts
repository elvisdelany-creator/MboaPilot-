import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { executerJobQuotidien } from "./job-quotidien.service.js";

// Test grandeur nature « horloge » : un seul démarrage avec une date avancée de 300 jours marquait les abonnements clients actifs comme expirés,
// et corriger l'heure ne les rétablissait pas.
let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;
let idAbonne: number;

const AUJOURD_HUI = "2026-11-25";
const DATE_FAUSSE = "2027-09-21"; // 300 jours plus loin

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  const idFamille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  idFormule = db.insert(schema.formule).values({ idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
  idAbonne = db.insert(schema.abonne).values({ siteId, nom: "N", prenom: "P", telephone: "690000001" }).returning().get().idAbonne;
});

const abonnement = (dateFin: string, statut: "ACTIF" | "RESILIE" = "ACTIF") =>
  db.insert(schema.abonnement).values({ idAbonne, idFormule, siteId, dateDebut: "2026-11-01", dateFin, statut, creePar: userId }).returning().get().numeroAbonnement;
const statut = (numero: number) => db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numero)).get()!.statut;
const historique = (numero: number) => db.select().from(schema.historiqueAbonnement).where(eq(schema.historiqueAbonnement.numeroAbonnement, numero)).all();
const commission = (numeroAbonnement: number, dateFinProbatoire: string) =>
  db.insert(schema.suiviCommissionCanalplus).values({ numeroAbonnement, dateFinProbatoire, montantCommission: 1000 }).returning().get().idSuivi;
const suivi = (idSuivi: number) => db.select().from(schema.suiviCommissionCanalplus).where(eq(schema.suiviCommissionCanalplus.idSuivi, idSuivi)).get()!.statut;

describe("horloge avancée par erreur puis corrigée", () => {
  it("les abonnements encore valables redeviennent actifs, avec la trace de la correction", () => {
    const valable = abonnement("2026-12-20");
    const dernierJour = abonnement(AUJOURD_HUI);
    executerJobQuotidien(db, DATE_FAUSSE);
    expect(statut(valable)).toBe("EXPIRE");

    const resultat = executerJobQuotidien(db, AUJOURD_HUI);

    expect(statut(valable)).toBe("ACTIF");
    expect(statut(dernierJour)).toBe("ACTIF");
    expect(resultat.abonnementsRetablis).toBe(2);
    expect(historique(valable).map((h) => [h.valeurAvant, h.valeurApres, h.motif])).toEqual([
      ["ACTIF", "EXPIRE", "expiration_automatique"],
      ["EXPIRE", "ACTIF", "correction_horloge"],
    ]);
  });

  it("ce qui a réellement expiré le reste, et une résiliation n'est jamais défaite", () => {
    const echu = abonnement("2026-11-24");
    const resilie = abonnement("2026-12-20", "RESILIE");
    executerJobQuotidien(db, DATE_FAUSSE);

    const resultat = executerJobQuotidien(db, AUJOURD_HUI);

    expect(statut(echu)).toBe("EXPIRE");
    expect(statut(resilie)).toBe("RESILIE");
    expect(resultat.abonnementsRetablis).toBe(0);
  });

  it("sans erreur d'horloge, rien n'est rétabli d'un jour à l'autre", () => {
    abonnement("2026-11-24");
    executerJobQuotidien(db, AUJOURD_HUI);

    expect(executerJobQuotidien(db, "2026-11-26").abonnementsRetablis).toBe(0);
  });

  it("une expiration qui n'est pas automatique n'est pas touchée", () => {
    const manuel = abonnement("2026-12-20");
    db.update(schema.abonnement).set({ statut: "EXPIRE" }).where(eq(schema.abonnement.numeroAbonnement, manuel)).run();

    executerJobQuotidien(db, AUJOURD_HUI);

    expect(statut(manuel)).toBe("EXPIRE");
  });

  it("la commission annulée par la fausse expiration reprend son suivi", () => {
    const suiviCourt = commission(abonnement("2026-12-01"), "2027-03-01");
    executerJobQuotidien(db, DATE_FAUSSE);
    expect(suivi(suiviCourt)).toBe("ANNULEE");

    executerJobQuotidien(db, AUJOURD_HUI);

    expect(suivi(suiviCourt)).toBe("EN_COURS");
  });

  it("une commission confirmée avant la fin de sa période probatoire reprend son suivi", () => {
    const suiviLong = commission(abonnement("2028-01-01"), "2027-03-01");
    executerJobQuotidien(db, DATE_FAUSSE);
    expect(suivi(suiviLong)).toBe("CONFIRMEE");

    executerJobQuotidien(db, AUJOURD_HUI);

    expect(suivi(suiviLong)).toBe("EN_COURS");
  });

  it("une commission réellement acquise ou perdue ne bouge pas", () => {
    const perdue = commission(abonnement("2026-11-20"), "2027-03-01");
    const acquise = commission(abonnement("2026-12-20"), "2026-11-01");
    executerJobQuotidien(db, AUJOURD_HUI);
    expect([suivi(perdue), suivi(acquise)]).toEqual(["ANNULEE", "CONFIRMEE"]);

    executerJobQuotidien(db, "2026-11-26");

    expect([suivi(perdue), suivi(acquise)]).toEqual(["ANNULEE", "CONFIRMEE"]);
  });

  it("un rappel daté du futur n'empêche pas le vrai rappel", () => {
    const numero = abonnement("2026-11-28");
    executerJobQuotidien(db, "2026-11-26"); // même palier de rappel que le vrai jour

    const resultat = executerJobQuotidien(db, AUJOURD_HUI);

    expect(resultat.alertesCreees).toBe(1);
    expect(db.select().from(schema.alerteEcheance).where(eq(schema.alerteEcheance.numeroAbonnement, numero)).all().map((a) => a.dateDeclenchement).sort()).toEqual(["2026-11-25", "2026-11-26"]);
  });
});
