import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { recruterAbonne } from "./recrutement.service.js";
import { reabonner } from "./reabonnement.service.js";
import { changerFormule } from "./changement-formule.service.js";
import { compterEcransOccupes } from "../comptes-partages/compte-partage.repository.js";
import { resilierAbonnement } from "./resiliation.service.js";

let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;
let idToutCanal: number;
let idKit: number;
let numeroAbonnement: number;

const abonnement = () => db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get()!;
const suivi = () => db.select().from(schema.suiviCommissionCanalplus).where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, numeroAbonnement)).get();
const historique = () => db.select().from(schema.historiqueAbonnement).where(eq(schema.historiqueAbonnement.numeroAbonnement, numeroAbonnement)).all();

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "G", prenom: "Gérant", identifiant: "gerant", motDePasseHash: "h", role: "GERANT" })
    .returning()
    .get().idUser;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  idFormule = db.insert(schema.formule).values({ idFamille: famille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
  idToutCanal = db.insert(schema.formule).values({ idFamille: famille, libelle: "TOUT CANAL+", prix: 28000, rang: 4 }).returning().get().idFormule;
  idKit = db
    .insert(schema.kit)
    .values({ idFamille: famille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", prixParaboleAccessoires: 0 })
    .returning()
    .get().idKit;
  db.insert(schema.kitPrixDecodeur).values({ idKit, idFormule, prixDecodeur: 5000 }).run();
  // recrutement CANAL+ avec kit payé comptant le 2026-10-01 : actif jusqu'au 2026-10-30, probation jusqu'au 2027-01-28
  numeroAbonnement = recruterAbonne(db, {
    siteId,
    userId,
    aujourdHui: "2026-10-01",
    abonne: { nom: "Ngo", prenom: "Paul", telephone: "677000555" },
    idFormule,
    idKit,
    montantEncaisse: 15500,
  }).numeroAbonnement;
});

// 4.3 : « ACTIF → RESILIE (action manuelle) — demande du client, litige, matériel non restitué », état terminal. Le statut était lu
// partout (fiche client, réabonnement, caisse) mais aucune action ne pouvait le produire.
describe("resilierAbonnement (4.3)", () => {
  it("passe l'abonnement à RESILIE et garde le motif et l'auteur dans l'historique", () => {
    resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2026-10-10", motif: "Demande du client (déménagement)" });

    expect(abonnement().statut).toBe("RESILIE");
    const histo = historique();
    expect(histo).toHaveLength(1);
    expect(histo[0]).toMatchObject({ typeChangement: "STATUT", valeurAvant: "ACTIF", valeurApres: "RESILIE", utilisateurId: userId });
    expect(histo[0].motif).toContain("Demande du client (déménagement)");
  });

  it("annule la commission CANAL+ en cours quand la résiliation tombe pendant la période probatoire", () => {
    expect(suivi()?.statut).toBe("EN_COURS");

    const resultat = resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2026-10-10", motif: "litige" });

    expect(suivi()?.statut).toBe("ANNULEE");
    expect(resultat.commissionAnnulee).toBe(true);
  });

  it("n'annule pas une commission dont la période probatoire est déjà écoulée : elle est acquise", () => {
    const resultat = resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2027-02-15", motif: "litige" });

    expect(suivi()?.statut).toBe("CONFIRMEE");
    expect(resultat.commissionAnnulee).toBe(false);
  });

  it("laisse intacte une commission déjà confirmée ou annulée", () => {
    db.update(schema.suiviCommissionCanalplus).set({ statut: "CONFIRMEE" }).where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, numeroAbonnement)).run();

    resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2026-10-10", motif: "litige" });

    expect(suivi()?.statut).toBe("CONFIRMEE");
  });

  it("libère l'écran d'un compte partagé", () => {
    const compte = db
      .insert(schema.comptePartageStreaming)
      .values({ siteId, idFamille: db.select().from(schema.formule).where(eq(schema.formule.idFormule, idFormule)).get()!.idFamille, libelle: "Compte A", nombreEcransMax: 2 })
      .returning()
      .get();
    db.update(schema.abonnement).set({ idComptePartage: compte.idComptePartage }).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).run();
    expect(compterEcransOccupes(db, compte.idComptePartage)).toBe(1);

    resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2026-10-10", motif: "demande du client" });

    expect(compterEcransOccupes(db, compte.idComptePartage)).toBe(0);
  });

  it("exige un motif texte non vide, sans rien modifier", () => {
    for (const motif of ["", "   ", undefined, 42, null]) {
      expect(() => resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2026-10-10", motif: motif as never })).toThrow(/motif/i);
    }
    expect(abonnement().statut).toBe("ACTIF");
    expect(historique()).toHaveLength(0);
  });

  it("refuse un abonnement déjà résilié, expiré ou inconnu", () => {
    resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2026-10-10", motif: "litige" });
    expect(() => resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2026-10-11", motif: "encore" })).toThrow(/déjà résilié/i);

    db.update(schema.abonnement).set({ statut: "EXPIRE" }).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).run();
    expect(() => resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2026-11-05", motif: "litige" })).toThrow(/expiré/i);

    expect(() => resilierAbonnement(db, { numeroAbonnement: 999, userId, aujourdHui: "2026-10-10", motif: "litige" })).toThrow(/introuvable/i);
  });

  it("accepte un abonnement encore ACTIF dont la date de fin est passée (le job n'a pas encore tourné)", () => {
    resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2026-11-02", motif: "matériel non restitué" });

    expect(abonnement().statut).toBe("RESILIE");
  });
});

// 4.3 : RESILIE est un état terminal — « un nouvel abonnement (nouveau numéro) peut être recréé pour le même abonné ». Un
// réabonnement ou un changement de formule ne le ressuscite pas.
describe("un abonnement résilié reste résilié (4.3)", () => {
  beforeEach(() => {
    resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: "2026-10-10", motif: "demande du client" });
  });

  it("refuse le réabonnement, sans facture ni changement", () => {
    expect(() => reabonner(db, { siteId, userId, aujourdHui: "2026-10-12", numeroAbonnement, montantEncaisse: 10500 })).toThrow(/résilié/i);

    expect(abonnement().statut).toBe("RESILIE");
    expect(db.select().from(schema.facture).all()).toHaveLength(1);
  });

  it("refuse le changement de formule", () => {
    expect(() => changerFormule(db, { siteId, userId, aujourdHui: "2026-10-12", numeroAbonnement, idNouvelleFormule: idToutCanal, montantEncaisse: 17500 })).toThrow();

    expect(abonnement().statut).toBe("RESILIE");
    expect(abonnement().idFormule).toBe(idFormule);
  });

  it("autorise un nouveau recrutement du même abonné, sous un nouveau numéro", () => {
    const nouveau = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2026-10-20",
      abonne: { idAbonne: abonnement().idAbonne },
      idFormule,
      montantEncaisse: 10500,
    });

    expect(nouveau.numeroAbonnement).not.toBe(numeroAbonnement);
    expect(abonnement().statut).toBe("RESILIE");
  });
});
