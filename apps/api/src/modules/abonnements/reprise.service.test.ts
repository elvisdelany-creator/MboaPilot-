import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { reprendreAbonneExistant } from "./reprise.service.js";
import { reabonner } from "./reabonnement.service.js";
import { resilierAbonnement } from "./resiliation.service.js";
import { compterEcransOccupes } from "../comptes-partages/compte-partage.repository.js";

let db: Db;
let siteId: number;
let autreSiteId: number;
let userId: number;
let idFormule: number;
let idApporteur: number;
let idComptePartage: number;
let idFamilleStreaming: number;
let idFormuleStreaming: number;

const AUJOURDHUI = "2026-11-07";

// Jour 1 en boutique : le commerçant a déjà des abonnés CANAL+ en cours, avec leur vraie date de fin. Le seul chemin de saisie était un
// « recrutement », qui invente une vente d'aujourd'hui (chiffre d'affaires et commission faux, abonnement qui repart d'aujourd'hui).
// La reprise enregistre ce qui existe déjà, sans rien facturer ni encaisser.
beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "G", prenom: "Gérant", identifiant: "gerant", motDePasseHash: "h", role: "GERANT" }).returning().get().idUser;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  idFormule = db.insert(schema.formule).values({ idFamille: famille, libelle: "EVASION", prix: 10500, rang: 3 }).returning().get().idFormule;
  idApporteur = db.insert(schema.sousDistributeur).values({ nom: "Agence", telephone: "655000111", tauxCommissionDefaut: 100 }).returning().get().idApporteur;
  idFamilleStreaming = db.insert(schema.familleAbonnement).values({ libelle: "STREAMING" }).returning().get().idFamille;
  idFormuleStreaming = db.insert(schema.formule).values({ idFamille: idFamilleStreaming, libelle: "NETFLIX 1 ÉCRAN", prix: 3000, rang: 1 }).returning().get().idFormule;
  idComptePartage = db.insert(schema.comptePartageStreaming).values({ siteId, idFamille: idFamilleStreaming, libelle: "Netflix #1", nombreEcransMax: 1 }).returning().get().idComptePartage;
});

const base = () => ({ siteId, userId, aujourdHui: AUJOURDHUI, abonne: { nom: "Ngo", prenom: "Paul", telephone: "677000555" }, idFormule, dateFin: "2026-11-25" });
const abonnement = (numero: number) => db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numero)).get()!;
const compte = (nom: string) => (db.$client.prepare(`select count(*) n from ${nom}`).get() as { n: number }).n;

describe("reprendreAbonneExistant (4.1, 7.1)", () => {
  it("enregistre l'abonné et son abonnement avec la VRAIE date de fin, actif", () => {
    const { numeroAbonnement } = reprendreAbonneExistant(db, base());

    const a = abonnement(numeroAbonnement);
    expect(a.dateFin).toBe("2026-11-25");
    expect(a.statut).toBe("ACTIF");
    expect(a.idFormule).toBe(idFormule);
    expect(a.siteId).toBe(siteId);
    expect(a.creePar).toBe(userId);
    expect(db.select().from(schema.abonne).where(eq(schema.abonne.idAbonne, a.idAbonne)).get()).toMatchObject({ nom: "Ngo", prenom: "Paul", telephone: "677000555" });
  });

  it("renvoie l'abonné concerné et le statut repris, pour ouvrir sa fiche tout de suite", () => {
    const resultat = reprendreAbonneExistant(db, base());

    expect(resultat).toEqual({ numeroAbonnement: expect.any(Number), idAbonne: abonnement(resultat.numeroAbonnement).idAbonne, statut: "ACTIF" });
  });

  it("ne crée AUCUNE facture, paiement, ligne de vente, commission ni mouvement de stock : rien n'a été vendu aujourd'hui", () => {
    reprendreAbonneExistant(db, base());

    for (const table of ["facture", "paiement", "ligne_vente", "suivi_commission_canalplus", "commission_canalplus_en_attente", "stock_mouvement"]) {
      expect(compte(table), table).toBe(0);
    }
  });

  it("trace la reprise dans l'historique de l'abonnement, avec l'auteur et le motif", () => {
    const { numeroAbonnement } = reprendreAbonneExistant(db, base());

    const histo = db.select().from(schema.historiqueAbonnement).where(eq(schema.historiqueAbonnement.numeroAbonnement, numeroAbonnement)).all();
    expect(histo).toHaveLength(1);
    expect(histo[0]).toMatchObject({ typeChangement: "STATUT", valeurAvant: null, valeurApres: "ACTIF", utilisateurId: userId });
    expect(histo[0].motif).toMatch(/reprise/i);
    expect(histo[0].motif).toContain("2026-11-25");
  });

  it("reprend un abonné déjà connu sans recréer sa fiche", () => {
    const idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Deja", prenom: "Connu", telephone: "699111222" }).returning().get().idAbonne;

    const { numeroAbonnement } = reprendreAbonneExistant(db, { ...base(), abonne: { idAbonne } });

    expect(abonnement(numeroAbonnement).idAbonne).toBe(idAbonne);
    expect(compte("abonne")).toBe(1);
  });

  it("enregistre le décodeur installé quand son numéro de série est connu", () => {
    const { numeroAbonnement } = reprendreAbonneExistant(db, { ...base(), numeroSerie: "SN-123", typeMateriel: "DECODEUR" });

    const materiel = db.select().from(schema.materielAbonne).where(eq(schema.materielAbonne.numeroAbonnement, numeroAbonnement)).all();
    expect(materiel).toMatchObject([{ typeMateriel: "DECODEUR", numeroSerie: "SN-123", statut: "ACTIF" }]);
  });

  it("n'enregistre aucun matériel sans numéro de série", () => {
    reprendreAbonneExistant(db, base());
    expect(compte("materiel_abonne")).toBe(0);
  });

  it("garde le lien apporteur d'un nouvel abonné", () => {
    const { numeroAbonnement } = reprendreAbonneExistant(db, { ...base(), abonne: { nom: "Ngo", prenom: "Paul", telephone: "677000555", apporteurId: idApporteur } });

    expect(abonnement(numeroAbonnement).apporteurId).toBe(idApporteur);
  });

  it("un abonnement dont la fin est déjà passée est repris EXPIRE : il apparaît dans les expirés à reconquérir", () => {
    const { numeroAbonnement } = reprendreAbonneExistant(db, { ...base(), dateFin: "2026-10-20" });

    expect(abonnement(numeroAbonnement).statut).toBe("EXPIRE");
  });

  it("l'abonnement qui finit aujourd'hui reste ACTIF jusqu'à la fin de la journée", () => {
    const { numeroAbonnement } = reprendreAbonneExistant(db, { ...base(), dateFin: AUJOURDHUI });
    expect(abonnement(numeroAbonnement).statut).toBe("ACTIF");
  });

  it("un abonnement repris se réabonne sans jour perdu : la nouvelle période prolonge la vraie date de fin", () => {
    const { numeroAbonnement } = reprendreAbonneExistant(db, base());

    reabonner(db, { siteId, userId, aujourdHui: AUJOURDHUI, numeroAbonnement, idFormule, montantEncaisse: 10500 });

    // fin au 25/11 : le réabonnement prend le relais le 26/11 pour un cycle de 30 jours
    expect(abonnement(numeroAbonnement).dateFin).toBe("2026-12-25");
  });

  it("un abonnement repris se résilie sans commission à annuler", () => {
    const { numeroAbonnement } = reprendreAbonneExistant(db, base());

    expect(resilierAbonnement(db, { numeroAbonnement, userId, aujourdHui: AUJOURDHUI, motif: "client parti" })).toEqual({ numeroAbonnement, commissionAnnulee: false });
  });
});

describe("reprendreAbonneExistant : garde-fous", () => {
  it.each([
    ["vide", ""],
    ["mal formée", "25/11/2026"],
    ["impossible", "2026-02-30"],
    ["trop lointaine (plus de 2 ans)", "2029-01-01"],
    ["trop ancienne (plus d'un an)", "2025-01-01"],
  ])("refuse une date de fin %s", (_nom, dateFin) => {
    expect(() => reprendreAbonneExistant(db, { ...base(), dateFin })).toThrow(/date de fin/i);
    expect(compte("abonnement")).toBe(0);
    expect(compte("abonne")).toBe(0);
  });

  it("refuse une formule inconnue, sans laisser d'abonné créé", () => {
    expect(() => reprendreAbonneExistant(db, { ...base(), idFormule: 9999 })).toThrow(/formule/i);
    expect(compte("abonne")).toBe(0);
  });

  it("accepte une formule retirée de la vente : l'abonné, lui, l'a encore", () => {
    db.update(schema.formule).set({ actif: 0 }).where(eq(schema.formule.idFormule, idFormule)).run();

    expect(() => reprendreAbonneExistant(db, base())).not.toThrow();
  });

  it("refuse un abonné d'un autre site", () => {
    const idAbonne = db.insert(schema.abonne).values({ siteId: autreSiteId, nom: "Ailleurs", prenom: "A", telephone: "699000000" }).returning().get().idAbonne;

    expect(() => reprendreAbonneExistant(db, { ...base(), abonne: { idAbonne } })).toThrow(/site/i);
  });

  it("refuse un abonné introuvable", () => {
    expect(() => reprendreAbonneExistant(db, { ...base(), abonne: { idAbonne: 9999 } })).toThrow(/introuvable/i);
  });

  it("refuse un apporteur désactivé", () => {
    db.update(schema.sousDistributeur).set({ actif: 0 }).where(eq(schema.sousDistributeur.idApporteur, idApporteur)).run();

    expect(() => reprendreAbonneExistant(db, { ...base(), abonne: { nom: "Ngo", prenom: "Paul", telephone: "677000555", apporteurId: idApporteur } })).toThrow(/apporteur/i);
    expect(compte("abonne")).toBe(0);
  });
});

describe("reprendreAbonneExistant : compte streaming partagé (5.9)", () => {
  it("occupe un écran du compte, comme un recrutement", () => {
    reprendreAbonneExistant(db, { ...base(), idFormule: idFormuleStreaming, idComptePartage });

    expect(compterEcransOccupes(db, idComptePartage)).toBe(1);
  });

  it("refuse la reprise quand le compte n'a plus d'écran libre", () => {
    reprendreAbonneExistant(db, { ...base(), idFormule: idFormuleStreaming, idComptePartage });

    expect(() => reprendreAbonneExistant(db, { ...base(), abonne: { nom: "Autre", prenom: "B", telephone: "699222333" }, idFormule: idFormuleStreaming, idComptePartage })).toThrow(/capacité|écran/i);
  });

  it("refuse un compte d'une autre famille que la formule", () => {
    expect(() => reprendreAbonneExistant(db, { ...base(), idComptePartage })).toThrow(/famille/i);
  });
});
