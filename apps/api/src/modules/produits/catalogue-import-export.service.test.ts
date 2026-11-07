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
    // séparé par « ; » : avec des virgules, Excel en version française ouvre tout dans une seule colonne
    expect(lignes[0]).toBe("Type;Libelle;Categorie;PrixVente;CoutRevient;SuiviStock;SeuilAlerte");
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

  it("aller-retour avec libellés à virgule, point-virgule et guillemets : aucun doublon, aucune perte", () => {
    creerProduit(db, { siteId, type: "BIEN", libelle: 'Décodeur, "G11"; promo', categorie: "Matériel; neuf", prixVente: 15000 });

    const csv = exporterCatalogueCsv(db, siteId);
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

// Jour 1 en boutique : le commerçant importe ses centaines d'articles — mais sans colonne de stock, tous démarraient à 0 et il fallait
// ouvrir « Ajuster l'inventaire » article par article. La colonne facultative « Stock » enregistre la quantité de départ des articles
// CRÉÉS par l'import, tracée comme un ajustement d'inventaire. Jamais celle d'un article existant : réimporter un vieux fichier pour
// changer des prix ne doit pas remettre le stock d'il y a un mois.
describe("importerCatalogueCsv : stock initial (colonne facultative « Stock »)", () => {
  const ENTETE = "Type;Libelle;Categorie;PrixVente;CoutRevient;SuiviStock;SeuilAlerte;Stock";
  const stockDe = (libelle: string) => db.select().from(schema.produit).where(eq(schema.produit.libelle, libelle)).get()!.quantiteStock;
  const mouvements = () => db.select().from(schema.stockMouvement).all();

  it("enregistre la quantité de départ d'un article créé, comme un ajustement d'inventaire tracé", () => {
    const resultat = importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;Câble HDMI;;2500;1000;1;5;40`, userId);

    expect(resultat).toMatchObject({ crees: 1, erreurs: [], stockInitialise: 1, stockIgnore: 0 });
    expect(stockDe("Câble HDMI")).toBe(40);
    expect(mouvements()).toMatchObject([{ typeMouvement: "INVENTAIRE", quantite: 40, utilisateurId: userId, siteId }]);
    expect(mouvements()[0].motif).toMatch(/stock initial/i);
  });

  it("un fichier sans colonne « Stock » s'importe comme avant, stock à 0", () => {
    const resultat = importerCatalogueCsv(db, siteId, "Type;Libelle;Categorie;PrixVente;CoutRevient;SuiviStock;SeuilAlerte\nBIEN;Câble HDMI;;2500;1000;1;5", userId);

    expect(resultat).toMatchObject({ crees: 1, erreurs: [], stockInitialise: 0 });
    expect(stockDe("Câble HDMI")).toBe(0);
    expect(mouvements()).toHaveLength(0);
  });

  it("une cellule vide ou à 0 n'enregistre aucun mouvement", () => {
    importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;A;;100;;1;;\nBIEN;B;;100;;1;;0`, userId);

    expect(mouvements()).toHaveLength(0);
  });

  it("ne touche JAMAIS au stock d'un article existant : il est compté comme ignoré", () => {
    const existant = creerProduit(db, { siteId, type: "BIEN", libelle: "Câble HDMI", prixVente: 2500, suiviStock: true });
    db.update(schema.produit).set({ quantiteStock: 7 }).where(eq(schema.produit.idProduit, existant.idProduit)).run();

    const resultat = importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;Câble HDMI;;3000;;1;;999`, userId);

    expect(resultat).toMatchObject({ misAJour: 1, stockInitialise: 0, stockIgnore: 1 });
    expect(stockDe("Câble HDMI")).toBe(7);
    expect(mouvements()).toHaveLength(0);
  });

  it("refuse un stock invalide (négatif, décimal, texte) sans bloquer les autres lignes", () => {
    const resultat = importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;A;;100;;1;;-3\nBIEN;B;;100;;1;;2,5\nBIEN;C;;100;;1;;beaucoup\nBIEN;D;;100;;1;;12`, userId);

    expect(resultat.crees).toBe(1);
    expect(resultat.erreurs.map((e) => e.ligne)).toEqual([2, 3, 4]);
    expect(resultat.erreurs.every((e) => /stock/i.test(e.message))).toBe(true);
    expect(stockDe("D")).toBe(12);
  });

  it("refuse un stock sur un article non suivi en stock (service, ou SuiviStock à 0) : l'erreur le dit", () => {
    const resultat = importerCatalogueCsv(db, siteId, `${ENTETE}\nSERVICE;Installation;;5000;;0;;10\nBIEN;Piles;;300;;1;;10`, userId);

    expect(resultat.erreurs).toHaveLength(1);
    expect(resultat.erreurs[0]).toMatchObject({ ligne: 2 });
    expect(resultat.erreurs[0].message).toMatch(/suivi/i);
    expect(db.select().from(schema.produit).where(eq(schema.produit.libelle, "Installation")).get()).toBeUndefined();
    expect(stockDe("Piles")).toBe(10);
  });

  it("une ligne en erreur sur son stock n'enregistre ni l'article ni de mouvement", () => {
    importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;A;;100;;1;;-3`, userId);

    expect(db.select().from(schema.produit).all()).toHaveLength(0);
    expect(mouvements()).toHaveLength(0);
  });

  it("le coût de revient du CSV reste celui de l'article : le stock initial ne le recalcule pas", () => {
    importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;Câble HDMI;;2500;1000;1;;40`, userId);

    expect(db.select().from(schema.produit).get()!.coutRevient).toBe(1000);
  });
});
