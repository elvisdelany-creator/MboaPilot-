import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";

// Un catalogue réel peut compter plusieurs dizaines de milliers de références : l'import était refusé au-delà d'environ
// 11 000 lignes (limite de 1 Mo de Fastify) avec un message qui n'expliquait rien, et chaque ligne s'écrivait dans sa propre
// transaction (lent, et un import interrompu laissait un catalogue à moitié importé).
let db: Db;
let siteId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  creerUtilisateur(db, { siteId, nom: "G", prenom: "G", identifiant: "gerant", motDePasse: "motdepasse-secret", role: "GERANT" });
});

function csv(lignes: number, prefixe = "Article"): string {
  const corps = ["Type;Libelle;Categorie;PrixVente;CoutRevient;SuiviStock;SeuilAlerte"];
  for (let i = 0; i < lignes; i++) corps.push(`BIEN;${prefixe} numero ${i} avec un libelle assez long pour peser;Accessoires;${1000 + i};${500 + i};1;5`);
  return corps.join("\n");
}

async function importer(contenuCsv: string) {
  const app = buildApp(db, { jwtSecret: "secret-de-test" });
  const token = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "gerant", motDePasse: "motdepasse-secret" } })).json().token;
  return app.inject({ method: "POST", url: "/api/v1/produits/import-csv", headers: { authorization: `Bearer ${token}` }, payload: { contenuCsv } });
}

describe("import CSV du catalogue : gros fichiers", () => {
  it("accepte un fichier de plus de 1 Mo (environ 15 000 articles) et crée tous les articles", async () => {
    const contenu = csv(15000);
    expect(contenu.length).toBeGreaterThan(1024 * 1024);

    const reponse = await importer(contenu);

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toMatchObject({ crees: 15000, misAJour: 0, erreurs: [] });
    expect(db.select().from(schema.produit).all()).toHaveLength(15000);
  }, 120000);

  it("refuse un fichier de plus de 10 Mo avec un message qui dit quoi faire", async () => {
    const reponse = await importer(csv(120000));

    expect(reponse.statusCode).toBe(413);
    expect(reponse.json().erreur).toMatch(/volumineux/i);
    expect(reponse.json().erreur).toMatch(/fichiers|diviser|plusieurs/i);
    expect(db.select().from(schema.produit).all()).toHaveLength(0);
  }, 120000);

  it("rapporte les lignes invalides sans bloquer les lignes valides (comportement conservé)", async () => {
    const contenu = ["Type;Libelle;Categorie;PrixVente;CoutRevient;SuiviStock;SeuilAlerte", "BIEN;Bon article;;1000;500;1;5", "BIEN;;;1000;500;1;5", "BIEN;Autre bon article;;2000;900;1;5"].join("\n");

    const reponse = await importer(contenu);

    expect(reponse.json()).toMatchObject({ crees: 2 });
    expect(reponse.json().erreurs).toHaveLength(1);
    expect(reponse.json().erreurs[0].ligne).toBe(3);
  });
});
