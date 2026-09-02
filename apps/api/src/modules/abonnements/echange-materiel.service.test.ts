import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { recruterAbonne } from "./recrutement.service.js";
import { echangerMateriel } from "./echange-materiel.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;
let numeroAbonnement: number;
let idProduitDecodeur: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  idFormule = db
    .insert(schema.formule)
    .values({ idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 })
    .returning()
    .get().idFormule;
  idProduitDecodeur = db
    .insert(schema.produit)
    .values({ siteId, type: "BIEN", libelle: "Décodeur GLOBALZ (pièce détachée)", prixVente: 15000 })
    .returning()
    .get().idProduit;

  numeroAbonnement = recruterAbonne(db, {
    siteId,
    userId,
    aujourdHui: "2025-11-16",
    abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
    idFormule,
    montantEncaisse: 10500,
  }).numeroAbonnement;
});

describe("echangerMateriel (7.3)", () => {
  it("premier équipement : crée le matériel ACTIF, historique sans ancien matériel", () => {
    const resultat = echangerMateriel(db, {
      siteId,
      userId,
      numeroAbonnement,
      idProduit: idProduitDecodeur,
      typeMateriel: "DECODEUR",
      numeroSerie: "SN-001",
      sousGarantie: false,
      motif: "premier équipement",
      montantEncaisse: 15000,
    });

    expect(resultat.statutFacture).toBe("VALIDEE");
    expect(resultat.montantFacture).toBe(15000);

    const materiels = db.select().from(schema.materielAbonne).where(eq(schema.materielAbonne.numeroAbonnement, numeroAbonnement)).all();
    expect(materiels).toHaveLength(1);
    expect(materiels[0].statut).toBe("ACTIF");
    expect(materiels[0].numeroSerie).toBe("SN-001");

    const histo = db
      .select()
      .from(schema.historiqueAbonnement)
      .where(eq(schema.historiqueAbonnement.numeroAbonnement, numeroAbonnement))
      .all();
    expect(histo).toHaveLength(1);
    expect(histo[0].typeChangement).toBe("MATERIEL");
    expect(histo[0].valeurAvant).toBeNull();
    expect(histo[0].valeurApres).toBe("SN-001");
    expect(histo[0].motif).toBe("premier équipement");
    expect(histo[0].utilisateurId).toBe(userId);
  });

  it("panne sous garantie : remplacement gratuit, facture auto-validée sans encaissement", () => {
    echangerMateriel(db, {
      siteId,
      userId,
      numeroAbonnement,
      idProduit: idProduitDecodeur,
      typeMateriel: "DECODEUR",
      numeroSerie: "SN-001",
      sousGarantie: false,
      motif: "premier équipement",
      montantEncaisse: 15000,
    });

    const resultat = echangerMateriel(db, {
      siteId,
      userId,
      numeroAbonnement,
      idProduit: idProduitDecodeur,
      typeMateriel: "DECODEUR",
      numeroSerie: "SN-002",
      sousGarantie: true,
      motif: "panne",
      montantEncaisse: 0,
    });

    expect(resultat.montantFacture).toBe(0);
    expect(resultat.statutFacture).toBe("VALIDEE");

    const materiels = db
      .select()
      .from(schema.materielAbonne)
      .where(eq(schema.materielAbonne.numeroAbonnement, numeroAbonnement))
      .all();
    expect(materiels).toHaveLength(2);
    expect(materiels.find((m) => m.numeroSerie === "SN-001")?.statut).toBe("REMPLACE");
    expect(materiels.find((m) => m.numeroSerie === "SN-002")?.statut).toBe("ACTIF");

    const histo = db
      .select()
      .from(schema.historiqueAbonnement)
      .where(eq(schema.historiqueAbonnement.numeroAbonnement, numeroAbonnement))
      .all();
    const dernier = histo[histo.length - 1];
    expect(dernier.valeurAvant).toBe("SN-001");
    expect(dernier.valeurApres).toBe("SN-002");
    expect(dernier.motif).toBe("panne");
  });

  it("vol hors garantie, sans encaissement : facture reste BROUILLON au tarif plein", () => {
    const resultat = echangerMateriel(db, {
      siteId,
      userId,
      numeroAbonnement,
      idProduit: idProduitDecodeur,
      typeMateriel: "DECODEUR",
      sousGarantie: false,
      motif: "vol",
      montantEncaisse: 0,
    });

    expect(resultat.montantFacture).toBe(15000);
    expect(resultat.statutFacture).toBe("BROUILLON");
  });

  it("rejette un abonnement inconnu", () => {
    expect(() =>
      echangerMateriel(db, {
        siteId,
        userId,
        numeroAbonnement: 999999,
        idProduit: idProduitDecodeur,
        typeMateriel: "DECODEUR",
        sousGarantie: false,
        motif: "panne",
        montantEncaisse: 0,
      })
    ).toThrow(/introuvable/);
  });

  it("5.2 : décrémente le stock du produit de remplacement quand il est suivi", () => {
    const idProduitSuivi = db
      .insert(schema.produit)
      .values({ siteId, type: "BIEN", libelle: "Décodeur GLOBALZ (suivi)", prixVente: 15000, suiviStock: 1, quantiteStock: 10 })
      .returning()
      .get().idProduit;

    echangerMateriel(db, {
      siteId,
      userId,
      numeroAbonnement,
      idProduit: idProduitSuivi,
      typeMateriel: "DECODEUR",
      sousGarantie: false,
      motif: "panne",
      montantEncaisse: 15000,
    });

    const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduitSuivi)).get();
    expect(produit?.quantiteStock).toBe(9);

    const mouvements = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, idProduitSuivi)).all();
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0].typeMouvement).toBe("VENTE");
  });

  it("rejette un produit de remplacement inconnu", () => {
    expect(() =>
      echangerMateriel(db, {
        siteId,
        userId,
        numeroAbonnement,
        idProduit: 999999,
        typeMateriel: "DECODEUR",
        sousGarantie: false,
        motif: "panne",
        montantEncaisse: 0,
      })
    ).toThrow(/introuvable/);
  });
});
