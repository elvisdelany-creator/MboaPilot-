import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { creerProduit } from "./produit.repository.js";
import { importerCatalogueCsv } from "./catalogue-import-export.service.js";

// Constaté au test de saisies hostiles : deux défauts d'import qui ne font aucune erreur mais abîment le catalogue en silence.
let db: Db;
let siteId: number;
let userId: number;
const ENTETE = "Type;Libelle;Categorie;PrixVente;CoutRevient;SuiviStock;SeuilAlerte";
// caractères construits par code : aucun outil d'édition ne peut les remplacer par une espace ordinaire
const NBSP = String.fromCharCode(0xa0); // espace insécable : celle que French Excel met entre les mots
const NNBSP = String.fromCharCode(0x202f); // espace fine insécable
const TAB = String.fromCharCode(9);

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" }).returning().get().idUser;
});

const produits = () => db.select().from(schema.produit).all();
const produit = (libelle: string) => db.select().from(schema.produit).where(eq(schema.produit.libelle, libelle)).get();

describe("importerCatalogueCsv : un libellé aux espaces différents désigne le même article", () => {
  it.each([
    ["espace double", "Écran  Plat"],
    ["espace insécable (Excel français)", `Écran${NBSP}Plat`],
    ["espace fine insécable", `Écran${NNBSP}Plat`],
    ["tabulation", `Écran${TAB}Plat`],
    ["espaces autour et au milieu", "  écran   PLAT  "],
  ])("%s : met à jour l'article existant au lieu d'en créer un second", (_nom, libelle) => {
    creerProduit(db, { siteId, type: "BIEN", libelle: "Écran Plat", prixVente: 1000 });

    const resultat = importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;${libelle};;1400;;0;`, userId);

    expect(resultat).toMatchObject({ crees: 0, misAJour: 1, erreurs: [] });
    expect(produits()).toHaveLength(1);
    expect(produit("Écran Plat")?.prixVente).toBe(1400);
  });

  it("deux lignes du même fichier qui ne diffèrent que par les espaces : la seconde met à jour la première", () => {
    const resultat = importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;Écran Plat;;1000;;0;\nBIEN;Écran${NBSP}Plat;;1500;;0;`, userId);

    expect(resultat).toMatchObject({ crees: 1, misAJour: 1, erreurs: [] });
    expect(produits()).toHaveLength(1);
    expect(produits()[0].prixVente).toBe(1500);
  });

  it("deux articles réellement différents restent distincts", () => {
    importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;Écran Plat;;1000;;0;\nBIEN;Écran Courbe;;2000;;0;`, userId);

    expect(produits()).toHaveLength(2);
  });
});

describe("importerCatalogueCsv : la colonne SuiviStock", () => {
  it.each([["oui"], ["non"], ["TRUE"], ["vrai"], ["2"], ["-1"], ["1,0"], ["x"]])("la valeur « %s » est refusée avec un message qui dit quoi écrire, sans créer l'article", (valeur) => {
    const resultat = importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;Piles;;300;;${valeur};`, userId);

    expect(resultat.crees).toBe(0);
    expect(resultat.erreurs).toHaveLength(1);
    expect(resultat.erreurs[0].ligne).toBe(2);
    expect(resultat.erreurs[0].message).toMatch(/SuiviStock/);
    expect(resultat.erreurs[0].message).toContain(`"${valeur}"`);
    expect(resultat.erreurs[0].message).toMatch(/1.*0|0.*1/);
    expect(produits()).toHaveLength(0);
  });

  it("1 (suivi), 0 et cellule vide (non suivi) restent acceptés, avec des espaces autour", () => {
    const resultat = importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;Suivi;;100;;1;\nBIEN;Suivi espaces;;100;; 1 ;\nBIEN;Non suivi;;100;;0;\nBIEN;Vide;;100;;;`, userId);

    expect(resultat).toMatchObject({ crees: 4, erreurs: [] });
    expect(produit("Suivi")?.suiviStock).toBe(1);
    expect(produit("Suivi espaces")?.suiviStock).toBe(1);
    expect(produit("Non suivi")?.suiviStock).toBe(0);
    expect(produit("Vide")?.suiviStock).toBe(0);
  });

  it("une ligne invalide ne bloque pas les suivantes", () => {
    const resultat = importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;A;;100;;oui;\nBIEN;B;;100;;1;`, userId);

    expect(resultat.crees).toBe(1);
    expect(resultat.erreurs.map((e) => e.ligne)).toEqual([2]);
    expect(produit("B")?.suiviStock).toBe(1);
  });

  it("sur un article existant, une valeur invalide est aussi refusée : le prix n'est pas modifié", () => {
    creerProduit(db, { siteId, type: "BIEN", libelle: "Piles", prixVente: 300, suiviStock: true });

    const resultat = importerCatalogueCsv(db, siteId, `${ENTETE}\nBIEN;Piles;;999;;oui;`, userId);

    expect(resultat.erreurs).toHaveLength(1);
    expect(resultat.misAJour).toBe(0);
    expect(produit("Piles")?.prixVente).toBe(300);
  });
});
