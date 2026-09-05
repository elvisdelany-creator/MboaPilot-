import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { creerProduit } from "./produit.repository.js";
import { exporterCatalogueCsv, importerCatalogueCsv } from "./catalogue-import-export.service.js";

let db: Db;
let siteId: number;
let userId: number;
let idEntreprise: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  idEntreprise = ent.idEntreprise;
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" })
    .returning()
    .get().idUser;
});

describe("exporterCatalogueCsv (8.2)", () => {
  it("exporte les produits du site en CSV avec en-têtes", () => {
    creerProduit(db, { siteId, type: "BIEN", libelle: "Télécommande", prixVente: 2500, coutRevient: 1000, suiviStock: true, seuilAlerte: 3 });
    creerProduit(db, { siteId, type: "SERVICE", libelle: "Installation", prixVente: 5000 });

    const csv = exporterCatalogueCsv(db, siteId);
    const lignes = csv.trim().split("\r\n");
    expect(lignes[0]).toBe("Type,Libelle,Categorie,PrixVente,CoutRevient,SuiviStock,SeuilAlerte");
    expect(lignes).toHaveLength(3);
    expect(lignes[1]).toContain("Télécommande");
    expect(lignes[1]).toContain("2500");
  });

  it("n'exporte que les produits du site demandé", () => {
    const autreSite = db.insert(schema.site).values({ idEntreprise, nom: "Site B" }).returning().get().idSite;
    creerProduit(db, { siteId, type: "BIEN", libelle: "Article site A", prixVente: 1000 });
    creerProduit(db, { siteId: autreSite, type: "BIEN", libelle: "Article site B", prixVente: 2000 });

    const csv = exporterCatalogueCsv(db, siteId);
    expect(csv).toContain("Article site A");
    expect(csv).not.toContain("Article site B");
  });
});

describe("importerCatalogueCsv (8.2)", () => {
  it("crée les nouveaux articles absents du catalogue", () => {
    const csv = "Type,Libelle,Categorie,PrixVente,CoutRevient,SuiviStock,SeuilAlerte\nBIEN,Télécommande,Accessoires,2500,1000,1,3";

    const resultat = importerCatalogueCsv(db, siteId, csv, userId);

    expect(resultat.crees).toBe(1);
    expect(resultat.misAJour).toBe(0);
    expect(resultat.erreurs).toHaveLength(0);
    const produits = db.select().from(schema.produit).where(eq(schema.produit.siteId, siteId)).all();
    expect(produits).toHaveLength(1);
    expect(produits[0]).toMatchObject({ libelle: "Télécommande", prixVente: 2500, coutRevient: 1000, suiviStock: 1, seuilAlerte: 3 });
  });

  it("met à jour le prix d'un article existant, en journalisant l'historique (8.2 : mises à jour tarifaires en masse)", () => {
    const idProduit = creerProduit(db, { siteId, type: "BIEN", libelle: "Télécommande", prixVente: 2500, coutRevient: 1000 }).idProduit;
    const csv = "Type,Libelle,Categorie,PrixVente,CoutRevient,SuiviStock,SeuilAlerte\nBIEN,Télécommande,,3000,1200,0,";

    const resultat = importerCatalogueCsv(db, siteId, csv, userId);

    expect(resultat.crees).toBe(0);
    expect(resultat.misAJour).toBe(1);
    const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduit)).get();
    expect(produit?.prixVente).toBe(3000);
    expect(produit?.coutRevient).toBe(1200);
    const historique = db.select().from(schema.historiquePrixProduit).where(eq(schema.historiquePrixProduit.idProduit, idProduit)).all();
    expect(historique).toHaveLength(1);
  });

  it("associe une ligne à l'article existant par libellé, insensible à la casse", () => {
    creerProduit(db, { siteId, type: "BIEN", libelle: "Télécommande", prixVente: 2500 });
    const csv = "Type,Libelle,Categorie,PrixVente,CoutRevient,SuiviStock,SeuilAlerte\nBIEN,télécommande,,3000,,0,";

    const resultat = importerCatalogueCsv(db, siteId, csv, userId);

    expect(resultat.misAJour).toBe(1);
    expect(resultat.crees).toBe(0);
  });

  it("rapporte une erreur par ligne invalide sans interrompre l'import des lignes valides", () => {
    const csv = [
      "Type,Libelle,Categorie,PrixVente,CoutRevient,SuiviStock,SeuilAlerte",
      "INCONNU,Article invalide,,1000,,0,",
      "BIEN,,,,1000,0,",
      "BIEN,Câble HDMI,,1500,500,0,",
    ].join("\n");

    const resultat = importerCatalogueCsv(db, siteId, csv, userId);

    expect(resultat.crees).toBe(1);
    expect(resultat.erreurs).toHaveLength(2);
    expect(resultat.erreurs[0].ligne).toBe(2);
    expect(resultat.erreurs[1].ligne).toBe(3);
  });

  it("rejette un CSV sans les colonnes obligatoires", () => {
    expect(() => importerCatalogueCsv(db, siteId, "Foo,Bar\n1,2", userId)).toThrow(/colonnes/i);
  });
});
