import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { recruterAbonne } from "./recrutement.service.js";
import { echangerMateriel } from "./echange-materiel.service.js";
import { resilierAbonnement } from "./resiliation.service.js";
import { reprendreAbonneExistant } from "./reprise.service.js";

// constaté en test grandeur nature : le même numéro de série était accepté chez deux abonnés à la fois (recrutement puis échange).
// Le numéro de série sert à la garantie et au SAV : un décodeur ne peut pas être chez deux clients. En revanche la résiliation ne
// touche pas au matériel (il reste « ACTIF »), donc un décodeur rendu après résiliation doit pouvoir être réinstallé ailleurs.
let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;
let idKit: number;
let idProduitDecodeur: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  const evasion = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get();
  idFormule = evasion.idFormule;
  idKit = db.insert(schema.kit).values({ idFamille: famille.idFamille, libelle: "KIT CANAL+ GLOBALZ", reglePrix: "PRIX_DECODEUR_VARIABLE_SELON_FORMULE", prixParaboleAccessoires: 0 }).returning().get().idKit;
  db.insert(schema.kitPrixDecodeur).values({ idKit, idFormule, prixDecodeur: 5000 }).run();
  idProduitDecodeur = db.insert(schema.produit).values({ siteId, type: "BIEN", libelle: "Décodeur de remplacement", prixVente: 15000 }).returning().get().idProduit;
});

const recruter = (nom: string, telephone: string, numeroSerie?: string) =>
  recruterAbonne(db, { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom, prenom: "Test", telephone }, idFormule, idKit, numeroSerie, montantEncaisse: 15500 });

const echanger = (numeroAbonnement: number, numeroSerie: string) =>
  echangerMateriel(db, { siteId, userId, numeroAbonnement, idProduit: idProduitDecodeur, typeMateriel: "DECODEUR", numeroSerie, sousGarantie: false, motif: "panne", montantEncaisse: 15000 });

const materiels = (numeroAbonnement: number) => db.select().from(schema.materielAbonne).where(eq(schema.materielAbonne.numeroAbonnement, numeroAbonnement)).all();

describe("numéro de série d'un matériel installé", () => {
  it("refuse un recrutement dont la série est déjà installée chez un autre abonnement", () => {
    const a = recruter("Alpha", "677200001", "SN-0001");

    expect(() => recruter("Bravo", "677200002", "SN-0001")).toThrow(new RegExp(`SN-0001.*n° ${a.numeroAbonnement}`));
    // rien n'a été écrit pour le second client : ni abonnement, ni facture
    expect(db.select().from(schema.abonnement).all()).toHaveLength(1);
    expect(db.select().from(schema.facture).all()).toHaveLength(1);
  });

  it("compare sans tenir compte de la casse ni des espaces autour", () => {
    recruter("Alpha", "677200001", "SN-0001");

    expect(() => recruter("Bravo", "677200002", "  sn-0001 ")).toThrow(/déjà installé/);
  });

  it("refuse un échange vers une série déjà active chez un autre abonnement", () => {
    const a = recruter("Alpha", "677200001", "SN-0001");
    const b = recruter("Bravo", "677200002", "SN-0002");

    expect(() => echanger(b.numeroAbonnement, "SN-0001")).toThrow(new RegExp(`n° ${a.numeroAbonnement}`));
    // l'échange refusé n'a rien modifié : matériel d'origine toujours actif, pas de facture d'échange
    expect(materiels(b.numeroAbonnement).map((m) => [m.numeroSerie, m.statut])).toEqual([["SN-0002", "ACTIF"]]);
    expect(db.select().from(schema.facture).all()).toHaveLength(2);
  });

  it("refuse une reprise d'abonné dont la série est déjà installée ailleurs", () => {
    recruter("Alpha", "677200001", "SN-0001");

    expect(() =>
      reprendreAbonneExistant(db, { siteId, userId, aujourdHui: "2025-11-16", abonne: { nom: "Repris", prenom: "Test", telephone: "677200003" }, idFormule, dateFin: "2025-12-10", numeroSerie: "SN-0001" }),
    ).toThrow(/déjà installé/);
  });

  // décision du gérant : un échange vers la série que l'abonné porte déjà ne change rien au matériel mais serait facturé plein tarif —
  // c'est une faute de saisie, refusée avant toute écriture
  it("refuse un échange vers la série que l'abonnement porte déjà, sans rien facturer", () => {
    const a = recruter("Alpha", "677200001", "SN-0001");

    expect(() => echanger(a.numeroAbonnement, " sn-0001 ")).toThrow(/déjà celui du matériel installé/);
    expect(materiels(a.numeroAbonnement).map((m) => [m.numeroSerie, m.statut])).toEqual([["SN-0001", "ACTIF"]]);
    expect(db.select().from(schema.facture).all()).toHaveLength(1); // seule la facture du recrutement
  });

  it("accepte un échange vers une nouvelle série, l'ancienne passant à REMPLACE", () => {
    const a = recruter("Alpha", "677200001", "SN-0001");

    expect(() => echanger(a.numeroAbonnement, "SN-0003")).not.toThrow();
    expect(materiels(a.numeroAbonnement).map((m) => [m.numeroSerie, m.statut])).toEqual([["SN-0001", "REMPLACE"], ["SN-0003", "ACTIF"]]);
  });

  it("accepte une série libérée par un échange : l'ancien matériel (REMPLACE) ne bloque personne", () => {
    const a = recruter("Alpha", "677200001", "SN-0001");
    echanger(a.numeroAbonnement, "SN-0003"); // SN-0001 est maintenant REMPLACE chez Alpha

    expect(() => recruter("Bravo", "677200002", "SN-0001")).not.toThrow();
  });

  it("accepte une série dont l'abonnement précédent est résilié (décodeur rendu, réinstallé chez un autre client)", () => {
    const a = recruter("Alpha", "677200001", "SN-0001");
    resilierAbonnement(db, { numeroAbonnement: a.numeroAbonnement, userId, aujourdHui: "2025-11-20", motif: "départ" });

    expect(() => recruter("Bravo", "677200002", "SN-0001")).not.toThrow();
  });

  it("garde l'abonnement expiré comme propriétaire : le client va se réabonner avec son décodeur", () => {
    const a = recruter("Alpha", "677200001", "SN-0001");
    db.update(schema.abonnement).set({ statut: "EXPIRE" }).where(eq(schema.abonnement.numeroAbonnement, a.numeroAbonnement)).run();

    expect(() => recruter("Bravo", "677200002", "SN-0001")).toThrow(/déjà installé/);
  });

  it("n'enregistre pas de série faite d'espaces : le matériel est créé sans numéro", () => {
    const a = recruter("Alpha", "677200001", "   ");

    expect(materiels(a.numeroAbonnement)[0].numeroSerie).toBeNull();
  });
});
