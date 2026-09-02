import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { recruterAbonne } from "./recrutement.service.js";
import { changerFormule } from "./changement-formule.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idAccess: number;
let idEvasion: number;
let idToutCanalplus: number;
let idDstvCompaq: number;
let numeroAbonnement: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;

  const canal = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  const dstv = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get();
  idAccess = db.insert(schema.formule).values({ idFamille: canal.idFamille, libelle: "ACCESS", prix: 5000, rang: 1 }).returning().get().idFormule;
  idEvasion = db.insert(schema.formule).values({ idFamille: canal.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
  idToutCanalplus = db.insert(schema.formule).values({ idFamille: canal.idFamille, libelle: "TOUT CANAL+", prix: 28000, rang: 4 }).returning().get().idFormule;
  idDstvCompaq = db.insert(schema.formule).values({ idFamille: dstv.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 }).returning().get().idFormule;

  numeroAbonnement = recruterAbonne(db, {
    siteId,
    userId,
    aujourdHui: "2025-11-16",
    abonne: { nom: "Nga", prenom: "Paul", telephone: "690000000" },
    idFormule: idAccess,
    montantEncaisse: 5000,
  }).numeroAbonnement;
});

describe("changerFormule (7.4)", () => {
  it("migration vers un rang supérieur : facture le différentiel et met à jour la formule sans toucher aux dates", () => {
    const abonnementAvant = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get()!;

    const resultat = changerFormule(db, { siteId, userId, numeroAbonnement, idNouvelleFormule: idEvasion, montantEncaisse: 5500 });

    expect(resultat.montantDifferentiel).toBe(5500); // 10500 - 5000
    expect(resultat.statutFacture).toBe("VALIDEE");

    const abonnementApres = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get()!;
    expect(abonnementApres.idFormule).toBe(idEvasion);
    expect(abonnementApres.dateDebut).toBe(abonnementAvant.dateDebut);
    expect(abonnementApres.dateFin).toBe(abonnementAvant.dateFin);

    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, resultat.idFacture)).get();
    expect(facture?.montantTotal).toBe(5500);
  });

  it("sans encaissement, la facture reste BROUILLON mais la formule change immédiatement", () => {
    const resultat = changerFormule(db, { siteId, userId, numeroAbonnement, idNouvelleFormule: idEvasion, montantEncaisse: 0 });

    expect(resultat.statutFacture).toBe("BROUILLON");
    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get()!;
    expect(abonnement.idFormule).toBe(idEvasion);
  });

  it("journalise le changement dans l'historique de l'abonnement", () => {
    changerFormule(db, { siteId, userId, numeroAbonnement, idNouvelleFormule: idEvasion, montantEncaisse: 5500 });

    const histo = db.select().from(schema.historiqueAbonnement).where(eq(schema.historiqueAbonnement.numeroAbonnement, numeroAbonnement)).all();
    expect(histo).toHaveLength(1);
    expect(histo[0].typeChangement).toBe("FORMULE");
    expect(histo[0].valeurAvant).toBe(String(idAccess));
    expect(histo[0].valeurApres).toBe(String(idEvasion));
    expect(histo[0].motif).toBe("migration");
  });

  it("rejette une formule identique", () => {
    expect(() => changerFormule(db, { siteId, userId, numeroAbonnement, idNouvelleFormule: idAccess, montantEncaisse: 0 })).toThrow(/identique/i);
  });

  it("rejette une formule de rang inférieur ou égal", () => {
    changerFormule(db, { siteId, userId, numeroAbonnement, idNouvelleFormule: idToutCanalplus, montantEncaisse: 23000 });
    // désormais sur TOUT CANAL+ (rang 4) — retenter EVASION (rang 2) doit être refusé
    expect(() => changerFormule(db, { siteId, userId, numeroAbonnement, idNouvelleFormule: idEvasion, montantEncaisse: 0 })).toThrow(/rang/i);
  });

  it("rejette une formule d'une autre famille", () => {
    expect(() => changerFormule(db, { siteId, userId, numeroAbonnement, idNouvelleFormule: idDstvCompaq, montantEncaisse: 0 })).toThrow(/famille/i);
  });

  it("rejette un abonnement non ACTIF (résilié)", () => {
    db.update(schema.abonnement).set({ statut: "RESILIE" }).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).run();
    expect(() => changerFormule(db, { siteId, userId, numeroAbonnement, idNouvelleFormule: idEvasion, montantEncaisse: 0 })).toThrow(/actif/i);
  });

  it("rejette un abonnement inconnu", () => {
    expect(() => changerFormule(db, { siteId, userId, numeroAbonnement: 999999, idNouvelleFormule: idEvasion, montantEncaisse: 0 })).toThrow(/introuvable/);
  });
});
