import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerAbonne } from "./abonne.repository.js";
import { recruterAbonne } from "../abonnements/recrutement.service.js";
import { creerApporteur } from "../apporteurs/apporteur.repository.js";
import { creerDossierSav } from "../sav/sav.repository.js";
import { construireFiche360 } from "./fiche-360.service.js";
import { envoyerNotificationAbonne } from "../notifications/notification.service.js";
import type { FournisseurNotification } from "../notifications/fournisseur.js";
import * as schema from "../../db/schema.js";

const fournisseurFactice: FournisseurNotification = { envoyer: () => ({ reussi: true }) };

let db: Db;
let siteId: number;
let userId: number;
let idFamilleCanalplus: number;
let idFormuleCanalplus: number;
let idFormuleDstv: number;

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
  idFamilleCanalplus = canal.idFamille;
  idFormuleCanalplus = db.insert(schema.formule).values({ idFamille: canal.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
  idFormuleDstv = db.insert(schema.formule).values({ idFamille: dstv.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 }).returning().get().idFormule;
});

describe("construireFiche360 (8.1)", () => {
  it("consolide coordonnées, abonnements toutes familles, matériel, factures, SAV et apporteur", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur" });
    const idAbonne = creerAbonne(db, { siteId, nom: "Nga", prenom: "Paul", telephone: "690000000", apporteurId: apporteur.idApporteur }).idAbonne;

    recruterAbonne(db, { siteId, userId, aujourdHui: "2025-11-16", abonne: { idAbonne }, idFormule: idFormuleCanalplus, montantEncaisse: 10500 });
    recruterAbonne(db, { siteId, userId, aujourdHui: "2025-11-16", abonne: { idAbonne }, idFormule: idFormuleDstv, montantEncaisse: 13000 });
    creerDossierSav(db, { siteId, idAbonne, descriptionPanne: "Ne s'allume plus", sousGarantie: false, userId });

    const fiche = construireFiche360(db, idAbonne);

    expect(fiche.abonne.nom).toBe("Nga");
    expect(fiche.apporteur?.nom).toBe("Jean Apporteur");
    expect(fiche.abonnements).toHaveLength(2);
    expect(fiche.abonnements.map((a) => a.familleLibelle).sort()).toEqual(["CANAL+", "DSTV"]);
    expect(fiche.abonnements.find((a) => a.familleLibelle === "CANAL+")?.idFamille).toBe(idFamilleCanalplus);
    expect(fiche.factures).toHaveLength(2);
    expect(fiche.dossiersSav).toHaveLength(1);
  });

  it("inclut les paiements de chaque facture et les commissions CANAL+ en cours", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur", tauxCommissionDefaut: 100 }); // 10 %
    const idAbonne = creerAbonne(db, { siteId, nom: "Nga", prenom: "Paul", telephone: "690000000", apporteurId: apporteur.idApporteur }).idAbonne;

    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { idAbonne },
      idFormule: idFormuleCanalplus,
      montantEncaisse: 10500,
      apporteurId: apporteur.idApporteur,
    });

    const fiche = construireFiche360(db, idAbonne);

    expect(fiche.paiements).toHaveLength(1);
    expect(fiche.paiements[0].montant).toBe(10500);
    expect(fiche.commissionsCanalplus).toHaveLength(1);
    expect(fiche.commissionsCanalplus[0].montantCommission).toBe(1050); // 10 % de 10500
    expect(fiche.commissionsCanalplus[0].statut).toBe("EN_COURS");
  });

  it("trie les factures de la plus récente à la plus ancienne", () => {
    const idAbonne = creerAbonne(db, { siteId, nom: "Nga", prenom: "Paul", telephone: "690000000" }).idAbonne;

    const premiere = recruterAbonne(db, { siteId, userId, aujourdHui: "2025-11-16", abonne: { idAbonne }, idFormule: idFormuleCanalplus, montantEncaisse: 10500 });
    const seconde = recruterAbonne(db, { siteId, userId, aujourdHui: "2025-11-16", abonne: { idAbonne }, idFormule: idFormuleDstv, montantEncaisse: 13000 });

    const fiche = construireFiche360(db, idAbonne);

    expect(fiche.factures.map((f) => f.idFacture)).toEqual([seconde.idFacture, premiere.idFacture]);
  });

  it("un abonné sans apporteur renvoie apporteur: null", () => {
    const idAbonne = creerAbonne(db, { siteId, nom: "Nga", prenom: "Paul", telephone: "690000000" }).idAbonne;

    const fiche = construireFiche360(db, idAbonne);

    expect(fiche.apporteur).toBeNull();
    expect(fiche.abonnements).toHaveLength(0);
    expect(fiche.materiels).toHaveLength(0);
  });

  it("rejette un abonné inconnu", () => {
    expect(() => construireFiche360(db, 999999)).toThrow(/introuvable/);
  });

  it("4.4, 8.3 : inclut le journal des notifications envoyées à l'abonné", () => {
    const idAbonne = creerAbonne(db, { siteId, nom: "Nga", prenom: "Paul", telephone: "690000000" }).idAbonne;
    envoyerNotificationAbonne(db, fournisseurFactice, { idAbonne, evenement: "SAV_PRET", message: "Votre appareil est prêt." });

    const fiche = construireFiche360(db, idAbonne);

    expect(fiche.notifications).toHaveLength(1);
    expect(fiche.notifications[0]).toMatchObject({ canal: "SMS", evenement: "SAV_PRET", statutEnvoi: "ENVOYEE" });
  });
});
