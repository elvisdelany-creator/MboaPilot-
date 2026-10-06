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

  // 8.2 : injection de formule CSV — un libellé en « =... » est neutralisé à
  // l'export (sinon le tableur l'exécute à l'ouverture), sans casser l'aller-retour
  it("neutralise un libellé en formule à l'export, et le réimport retrouve le même article (pas de doublon)", () => {
    creerProduit(db, { siteId, type: "BIEN", libelle: '=HYPERLINK("http://exemple.test";"clic")', prixVente: 1000 });

    const csv = exporterCatalogueCsv(db, siteId);
    expect(csv).toContain(`"'=HYPERLINK(""http://exemple.test"";""clic"")"`);

    const resultat = importerCatalogueCsv(db, siteId, csv, userId);

    expect(resultat).toMatchObject({ crees: 0, misAJour: 1, erreurs: [] });
    expect(db.select().from(schema.produit).all()).toHaveLength(1);
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

  // 8.2 : un tableur (Excel, copier-coller) perd fréquemment les accents —
  // sans normalisation, "Télécommande" et "Telecommande" créent deux fiches
  // au lieu de mettre à jour la même, un doublon silencieux en boutique
  it("associe une ligne à l'article existant par libellé, insensible aux accents", () => {
    creerProduit(db, { siteId, type: "BIEN", libelle: "Télécommande", prixVente: 2500 });
    const csv = "Type,Libelle,Categorie,PrixVente,CoutRevient,SuiviStock,SeuilAlerte\nBIEN,Telecommande,,3000,,0,";

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

  // 8.2 : constaté en test grandeur nature — Number("") vaut 0, donc une
  // cellule PrixVente laissée vide écrasait silencieusement le prix d'un
  // article existant par 0 FCFA, rapporté comme « 1 mis à jour, 0 erreur ».
  it("rejette un prix de vente vide au lieu de le traiter comme 0 — l'article existant est inchangé", () => {
    const idProduit = creerProduit(db, { siteId, type: "BIEN", libelle: "Télécommande", prixVente: 2500, coutRevient: 1000 }).idProduit;
    const csv = ["Type,Libelle,Categorie,PrixVente,CoutRevient,SuiviStock,SeuilAlerte", "BIEN,Télécommande,,,1000,0,"].join("\n");

    const resultat = importerCatalogueCsv(db, siteId, csv, userId);

    expect(resultat.misAJour).toBe(0);
    expect(resultat.erreurs).toHaveLength(1);
    expect(resultat.erreurs[0].message).toMatch(/prix/i);
    const produit = db.select().from(schema.produit).where(eq(schema.produit.idProduit, idProduit)).get();
    expect(produit?.prixVente).toBe(2500);
  });

  it("rejette un prix de vente décimal (les montants sont en FCFA entiers)", () => {
    const csv = ["Type,Libelle,Categorie,PrixVente,CoutRevient,SuiviStock,SeuilAlerte", "BIEN,Câble,,1500.5,,0,"].join("\n");

    const resultat = importerCatalogueCsv(db, siteId, csv, userId);

    expect(resultat.crees).toBe(0);
    expect(resultat.erreurs).toHaveLength(1);
  });

  it("rejette un coût de revient négatif et un seuil d'alerte négatif ou décimal", () => {
    const csv = [
      "Type,Libelle,Categorie,PrixVente,CoutRevient,SuiviStock,SeuilAlerte",
      "BIEN,Article A,,1500,-200,0,",
      "BIEN,Article B,,1500,500,1,-3",
      "BIEN,Article C,,1500,500,1,2.5",
    ].join("\n");

    const resultat = importerCatalogueCsv(db, siteId, csv, userId);

    expect(resultat.crees).toBe(0);
    expect(resultat.erreurs.map((e) => e.ligne)).toEqual([2, 3, 4]);
  });

  it("rejette un CSV sans les colonnes obligatoires", () => {
    expect(() => importerCatalogueCsv(db, siteId, "Foo,Bar\n1,2", userId)).toThrow(/colonnes/i);
  });
});
