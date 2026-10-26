import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { recruterAbonne } from "../abonnements/recrutement.service.js";
import { reabonner } from "../abonnements/reabonnement.service.js";
import { changerFormule } from "../abonnements/changement-formule.service.js";
import { echangerMateriel } from "../abonnements/echange-materiel.service.js";
import { annulerFactureEnAttente, listerVentesEnAttente } from "./annulation-facture.service.js";

let db: Db;
let siteId: number;
let userId: number;
let idDecodeur: number;
let idKit: number;
let idEvasion: number;
let idToutCanal: number;
let numeroAbonnement: number;

const decodeurs = () => db.select().from(schema.produit).where(eq(schema.produit.idProduit, idDecodeur)).get()!.quantiteStock;
const abonnement = () => db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get()!;
const historique = () => db.select().from(schema.historiqueAbonnement).all();
const facture = (idFacture: number) => db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
const reabonnementNonPaye = (aujourdHui = "2026-10-05", extra: { idFormule?: number } = {}) =>
  reabonner(db, { siteId, userId, aujourdHui, numeroAbonnement, montantEncaisse: 0, ...extra });
const echangeNonPaye = (motif = "panne", numeroSerie?: string) =>
  echangerMateriel(db, { siteId, userId, numeroAbonnement, idProduit: idDecodeur, typeMateriel: "DECODEUR", numeroSerie, sousGarantie: false, motif, montantEncaisse: 0 });
const transactionMobile = (idFacture: number, statut: "EN_ATTENTE" | "ECHOUEE") =>
  db
    .insert(schema.transactionMobileMoney)
    .values({ idFacture, parcours: "USSD_CLIENT", numeroTelephone: "690000000", montant: 10500, statut, dateExpiration: "2099-01-01T00:00:00.000Z" })
    .run();

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
  idEvasion = db.insert(schema.formule).values({ idFamille: famille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
  idToutCanal = db.insert(schema.formule).values({ idFamille: famille, libelle: "TOUT CANAL+", prix: 28000, rang: 4 }).returning().get().idFormule;
  idKit = db
    .insert(schema.kit)
    .values({ idFamille: famille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", prixParaboleAccessoires: 0 })
    .returning()
    .get().idKit;
  db.insert(schema.kitPrixDecodeur).values({ idKit, idFormule: idEvasion, prixDecodeur: 5000 }).run();
  db.insert(schema.kitPrixDecodeur).values({ idKit, idFormule: idToutCanal, prixDecodeur: 1000 }).run();
  idDecodeur = db
    .insert(schema.produit)
    .values({ siteId, type: "BIEN", libelle: "Décodeur GLOBALZ", prixVente: 5000, suiviStock: 1, quantiteStock: 5 })
    .returning()
    .get().idProduit;

  // abonnement payé comptant : 2026-10-01 -> 2026-10-30, avec son décodeur d'origine
  numeroAbonnement = recruterAbonne(db, {
    siteId,
    userId,
    aujourdHui: "2026-10-01",
    abonne: { nom: "Ngo", prenom: "Paul", telephone: "677000555" },
    idFormule: idEvasion,
    idKit,
    numeroSerie: "SN-ANCIEN",
    montantEncaisse: 15500,
  }).numeroAbonnement;
});

// 7.2, 7.3, 7.4 : réabonnement, changement de formule et échange de matériel modifient un abonnement EXISTANT. Payés par Mobile Money et
// jamais réglés, ils laissaient le mois offert, la formule supérieure ou le matériel neuf au client, sans rien qui le signale. L'annulation
// rétablit l'état d'avant, à condition que l'abonnement n'ait pas évolué depuis.
describe("annulerFactureEnAttente : opérations sur un abonnement existant", () => {
  it("réabonnement non payé : rétablit les dates d'avant, supprime la facture et journalise", () => {
    const avant = abonnement();
    const reab = reabonnementNonPaye();
    expect(abonnement().dateFin).not.toBe(avant.dateFin);

    annulerFactureEnAttente(db, { idFacture: reab.idFacture, userId });

    expect(abonnement()).toMatchObject({ dateDebut: avant.dateDebut, dateFin: avant.dateFin, statut: "ACTIF", idFormule: idEvasion });
    expect(facture(reab.idFacture)).toBeUndefined();
    expect(db.select().from(schema.operationAbonnementEnAttente).all()).toHaveLength(0);
    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "facture")).all();
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].valeurAvant!)).toMatchObject({ idFacture: reab.idFacture, operation: { type: "REABONNEMENT" } });
  });

  it("réabonnement avec changement de formule : rétablit la formule et supprime l'historique créé", () => {
    const reab = reabonnementNonPaye("2026-10-05", { idFormule: idToutCanal });
    expect(abonnement().idFormule).toBe(idToutCanal);
    expect(historique()).toHaveLength(1);

    annulerFactureEnAttente(db, { idFacture: reab.idFacture, userId });

    expect(abonnement().idFormule).toBe(idEvasion);
    expect(historique()).toHaveLength(0);
  });

  it("réabonnement en délai de grâce : rétablit aussi le statut d'avant", () => {
    db.update(schema.abonnement).set({ statut: "EXPIRE" }).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).run();
    const reab = reabonnementNonPaye("2026-11-02");
    expect(abonnement().statut).toBe("ACTIF");

    annulerFactureEnAttente(db, { idFacture: reab.idFacture, userId });

    expect(abonnement()).toMatchObject({ statut: "EXPIRE", dateFin: "2026-10-30" });
    expect(historique()).toHaveLength(0);
  });

  it("changement de formule non payé : rétablit la formule d'avant", () => {
    const chg = changerFormule(db, { siteId, userId, aujourdHui: "2026-10-05", numeroAbonnement, idNouvelleFormule: idToutCanal, montantEncaisse: 0 });
    expect(abonnement().idFormule).toBe(idToutCanal);

    annulerFactureEnAttente(db, { idFacture: chg.idFacture, userId });

    expect(abonnement().idFormule).toBe(idEvasion);
    expect(historique()).toHaveLength(0);
    expect(facture(chg.idFacture)).toBeUndefined();
  });

  it("échange de matériel non payé : l'ancien matériel redevient actif, le neuf disparaît, le stock revient", () => {
    const stockAvant = decodeurs();
    const echange = echangeNonPaye("panne", "SN-NEUF");
    expect(decodeurs()).toBe(stockAvant - 1);

    annulerFactureEnAttente(db, { idFacture: echange.idFacture, userId });

    expect(decodeurs()).toBe(stockAvant);
    const materiels = db.select().from(schema.materielAbonne).where(eq(schema.materielAbonne.numeroAbonnement, numeroAbonnement)).all();
    expect(materiels).toHaveLength(1);
    expect(materiels[0]).toMatchObject({ numeroSerie: "SN-ANCIEN", statut: "ACTIF" });
    expect(historique()).toHaveLength(0);
    expect(facture(echange.idFacture)).toBeUndefined();
  });

  it("refuse d'annuler un réabonnement quand l'abonnement a évolué depuis, mais l'accepte une fois le plus récent annulé", () => {
    const premier = reabonnementNonPaye("2026-10-05");
    const second = reabonnementNonPaye("2026-10-06");

    expect(() => annulerFactureEnAttente(db, { idFacture: premier.idFacture, userId })).toThrow(/évolué|plus récente/i);
    expect(facture(premier.idFacture)).toBeDefined();

    annulerFactureEnAttente(db, { idFacture: second.idFacture, userId });
    annulerFactureEnAttente(db, { idFacture: premier.idFacture, userId });

    expect(abonnement()).toMatchObject({ dateDebut: "2026-10-01", dateFin: "2026-10-30" });
  });

  it("refuse l'annulation d'un échange dont le matériel a déjà été remplacé", () => {
    const premier = echangeNonPaye("panne", "SN-1");
    echangeNonPaye("vol", "SN-2");

    expect(() => annulerFactureEnAttente(db, { idFacture: premier.idFacture, userId })).toThrow(/évolué|plus récente/i);
    expect(facture(premier.idFacture)).toBeDefined();
  });

  it("refuse tant qu'un paiement Mobile Money est en cours", () => {
    const reab = reabonnementNonPaye();
    transactionMobile(reab.idFacture, "EN_ATTENTE");

    expect(() => annulerFactureEnAttente(db, { idFacture: reab.idFacture, userId })).toThrow(/en cours/i);

    expect(abonnement().dateFin).not.toBe("2026-10-30");
  });

  it("supprime les transactions Mobile Money échouées de la facture annulée", () => {
    const reab = reabonnementNonPaye();
    transactionMobile(reab.idFacture, "ECHOUEE");

    annulerFactureEnAttente(db, { idFacture: reab.idFacture, userId });

    expect(db.select().from(schema.transactionMobileMoney).all()).toHaveLength(0);
  });

  it("n'enregistre rien quand l'opération est payée aussitôt", () => {
    reabonner(db, { siteId, userId, aujourdHui: "2026-10-05", numeroAbonnement, montantEncaisse: 10500 });

    expect(db.select().from(schema.operationAbonnementEnAttente).all()).toHaveLength(0);
  });

  it("apparaissent dans la liste avec leur type et l'abonnement concerné", () => {
    const reab = reabonnementNonPaye();
    const chg = changerFormule(db, { siteId, userId, aujourdHui: "2026-10-06", numeroAbonnement, idNouvelleFormule: idToutCanal, montantEncaisse: 0 });
    const echange = echangeNonPaye("vol");

    const liste = listerVentesEnAttente(db, siteId);

    const type = (idFacture: number) => liste.find((v) => v.idFacture === idFacture)?.type;
    expect(type(reab.idFacture)).toBe("REABONNEMENT");
    expect(type(chg.idFacture)).toBe("CHANGEMENT_FORMULE");
    expect(type(echange.idFacture)).toBe("ECHANGE_MATERIEL");
    expect(liste.every((v) => v.numeroAbonnement === numeroAbonnement)).toBe(true);
  });
});
