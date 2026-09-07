import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { recruterAbonne } from "./recrutement.service.js";
import { reabonner } from "./reabonnement.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let familleDstv: number;
let compaq: number;
let premium: number;
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

  familleDstv = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get().idFamille;
  compaq = db.insert(schema.formule).values({ idFamille: familleDstv, libelle: "COMPAQ", prix: 13000, rang: 3 }).returning().get().idFormule;
  premium = db.insert(schema.formule).values({ idFamille: familleDstv, libelle: "PREMIUM", prix: 28000, rang: 5 }).returning().get().idFormule;

  const recrutement = recruterAbonne(db, {
    siteId,
    userId,
    aujourdHui: "2025-11-16",
    abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
    idFormule: compaq,
    montantEncaisse: 13000,
  });
  numeroAbonnement = recrutement.numeroAbonnement;
});

describe("reabonner (7.2)", () => {
  it("reconduit la même formule, payé comptant -> nouvelle période, facture VALIDEE", () => {
    const resultat = reabonner(db, {
      siteId,
      userId,
      aujourdHui: "2025-12-20",
      numeroAbonnement,
      montantEncaisse: 13000,
    });

    expect(resultat.statutFacture).toBe("VALIDEE");

    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get();
    expect(abonnement?.statut).toBe("ACTIF");
    expect(abonnement?.idFormule).toBe(compaq);
    expect(abonnement?.dateDebut).toBe("2025-12-20");
    expect(abonnement?.dateFin).toBe("2026-01-18"); // 30 jours date à date

    const historique = db
      .select()
      .from(schema.historiqueAbonnement)
      .where(eq(schema.historiqueAbonnement.numeroAbonnement, numeroAbonnement))
      .all();
    expect(historique).toHaveLength(0); // pas de changement de formule
  });

  // 6.5 : "Virement bancaire — Banque émettrice, référence de virement"
  it("réabonnement payé par virement -> le paiement enregistre le mode et la référence de virement", () => {
    const resultat = reabonner(db, {
      siteId,
      userId,
      aujourdHui: "2025-12-20",
      numeroAbonnement,
      montantEncaisse: 13000,
      modePaiement: "VIREMENT",
      banque: "SGC",
      referenceVirement: "VIR-2025-000700",
    });

    const paiements = db.select().from(schema.paiement).where(eq(schema.paiement.idFacture, resultat.idFacture)).all();
    expect(paiements).toHaveLength(1);
    expect(paiements[0].mode).toBe("VIREMENT");
    expect(paiements[0].banque).toBe("SGC");
    expect(paiements[0].referenceVirement).toBe("VIR-2025-000700");
  });

  it("réabonnement avec changement de formule -> historique tracé", () => {
    reabonner(db, {
      siteId,
      userId,
      aujourdHui: "2025-12-20",
      numeroAbonnement,
      idFormule: premium,
      montantEncaisse: 28000,
    });

    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get();
    expect(abonnement?.idFormule).toBe(premium);

    const historique = db
      .select()
      .from(schema.historiqueAbonnement)
      .where(eq(schema.historiqueAbonnement.numeroAbonnement, numeroAbonnement))
      .all();
    expect(historique).toHaveLength(1);
    expect(historique[0].typeChangement).toBe("FORMULE");
    expect(historique[0].valeurAvant).toBe(String(compaq));
    expect(historique[0].valeurApres).toBe(String(premium));
  });

  it("réabonne un abonnement déjà EXPIRE -> repasse ACTIF", () => {
    db.update(schema.abonnement)
      .set({ statut: "EXPIRE" })
      .where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement))
      .run();

    reabonner(db, { siteId, userId, aujourdHui: "2026-02-01", numeroAbonnement, montantEncaisse: 13000 });

    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get();
    expect(abonnement?.statut).toBe("ACTIF");
  });

  it("sans encaissement, la facture reste BROUILLON", () => {
    const resultat = reabonner(db, { siteId, userId, aujourdHui: "2025-12-20", numeroAbonnement, montantEncaisse: 0 });
    expect(resultat.statutFacture).toBe("BROUILLON");
  });

  it("rejette un numéro d'abonnement inexistant", () => {
    expect(() =>
      reabonner(db, { siteId, userId, aujourdHui: "2025-12-20", numeroAbonnement: 999999, montantEncaisse: 13000 })
    ).toThrow(/introuvable/);
  });

  it("6.4, 7.2 : applique une remise ponctuelle sur le prix de la formule", () => {
    const resultat = reabonner(db, { siteId, userId, aujourdHui: "2025-12-20", numeroAbonnement, montantEncaisse: 12000, remise: 1000 });

    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, resultat.idFacture)).get();
    expect(facture?.montantTotal).toBe(12000);
    const ligne = db.select().from(schema.ligneVente).where(eq(schema.ligneVente.idFacture, resultat.idFacture)).all()[0];
    expect(ligne).toMatchObject({ prixApplique: 12000, remise: 1000 });
  });

  it("6.4 : rejette une remise dépassant le prix de la formule", () => {
    expect(() =>
      reabonner(db, { siteId, userId, aujourdHui: "2025-12-20", numeroAbonnement, montantEncaisse: 0, remise: 20000 })
    ).toThrow(/remise/i);
  });
});
