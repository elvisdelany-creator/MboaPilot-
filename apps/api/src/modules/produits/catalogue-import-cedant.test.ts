import { describe, it, expect } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { buildApp } from "../../app.js";
import { cederLaMain } from "../../lib/ceder-la-main.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";
import { importerCatalogueCsv, importerCatalogueCsvCedant } from "./catalogue-import-export.service.js";

// Constaté au test de saisies hostiles : importer 20 000 articles prend environ 9 secondes d'un seul bloc dans le serveur de la caisse, qui ne
// répond plus à personne pendant ce temps (un caissier qui encaisse attend). Le fichier est maintenant traité par tranches de quelques
// centaines de lignes, avec une pause entre chacune. Le résultat doit rester EXACTEMENT celui de l'import d'un seul bloc.
const ENTETE = "Type;Libelle;Categorie;PrixVente;CoutRevient;SuiviStock;SeuilAlerte;Stock";

function environnement(): { db: Db; siteId: number; userId: number } {
  const db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  const userId = db.insert(schema.utilisateur).values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" }).returning().get().idUser;
  return { db, siteId, userId };
}

// l'état de la boutique après import : tout ce qu'un import peut écrire
function photo(db: Db) {
  return {
    produits: db.select().from(schema.produit).all().map((p) => [p.libelle, p.type, p.categorie, p.prixVente, p.coutRevient, p.suiviStock, p.seuilAlerte, p.quantiteStock]),
    mouvements: db.select().from(schema.stockMouvement).all().map((m) => [m.typeMouvement, m.quantite, m.motif]),
  };
}

// un fichier qui mélange tout : créations avec stock, mises à jour, doublons dans le fichier (de part et d'autre des frontières de tranche),
// variantes d'écriture d'un même libellé, lignes invalides
function fichierMixte(): string {
  const lignes = [ENTETE];
  for (let i = 0; i < 60; i++) lignes.push(`BIEN;Article ${i};Cat ${i % 4};${100 + i};${50 + i};1;5;${i % 7}`);
  lignes.push("BIEN;article 3;;999;;1;;"); // même article que « Article 3 », ligne 64
  lignes.push("BIEN;;;100;;1;;"); // libellé vide
  lignes.push("BIEN;Prix faux;;abc;;1;;");
  lignes.push("SERVICE;Installation;;5000;;0;;10"); // stock sur un article non suivi
  lignes.push("BIEN;Article 10;;777;;1;;5"); // mise à jour ; stock ignoré
  for (let i = 0; i < 30; i++) lignes.push(`BIEN;Lot ${i};;${10 + i};;1;;`);
  lignes.push("BIEN;ARTICLE 59;;4242;;1;;"); // doublon éloigné
  return lignes.join("\n");
}

describe("importerCatalogueCsvCedant : le même import, fait par tranches", () => {
  it.each([1, 2, 7, 25, 200, 100_000])("tranches de %i ligne(s) : résultat et boutique identiques à l'import d'un seul bloc", async (lignesParTranche) => {
    const reference = environnement();
    const attendu = importerCatalogueCsv(reference.db, reference.siteId, fichierMixte(), reference.userId);

    const courant = environnement();
    const obtenu = await importerCatalogueCsvCedant(courant.db, courant.siteId, fichierMixte(), courant.userId, { lignesParTranche });

    expect(obtenu).toEqual(attendu);
    expect(photo(courant.db)).toEqual(photo(reference.db));
    // le fichier est bien varié : sinon l'égalité ne prouverait rien
    expect(attendu.crees).toBeGreaterThan(80);
    expect(attendu.misAJour).toBeGreaterThanOrEqual(3);
    expect(attendu.erreurs.length).toBeGreaterThanOrEqual(3);
    expect(attendu.stockInitialise).toBeGreaterThan(30);
  });

  it("par défaut : même résultat que l'import d'un seul bloc", async () => {
    const reference = environnement();
    const attendu = importerCatalogueCsv(reference.db, reference.siteId, fichierMixte(), reference.userId);
    const courant = environnement();

    expect(await importerCatalogueCsvCedant(courant.db, courant.siteId, fichierMixte(), courant.userId)).toEqual(attendu);
    expect(photo(courant.db)).toEqual(photo(reference.db));
  });

  it("refuse un fichier aux colonnes manquantes sans rien écrire, avec le même message", async () => {
    const { db, siteId, userId } = environnement();

    await expect(importerCatalogueCsvCedant(db, siteId, "Type;Libelle\nBIEN;A", userId)).rejects.toThrow(/Colonnes obligatoires manquantes/);
    expect(db.select().from(schema.produit).all()).toHaveLength(0);
  });

  it("un fichier vide ou sans ligne de données ne crée rien", async () => {
    const { db, siteId, userId } = environnement();

    expect(await importerCatalogueCsvCedant(db, siteId, "", userId)).toMatchObject({ crees: 0, misAJour: 0, erreurs: [] });
    expect(await importerCatalogueCsvCedant(db, siteId, ENTETE, userId)).toMatchObject({ crees: 0, misAJour: 0, erreurs: [] });
  });

  it("rend la main au serveur entre deux tranches : les autres requêtes peuvent passer", async () => {
    const { db, siteId, userId } = environnement();
    // une « autre requête » qui ne demande qu'un tour de boucle d'événements : elle n'avance que si l'import cède la main
    let tours = 0;
    let actif = true;
    const autreRequete = (async () => {
      while (actif) {
        tours += 1;
        await cederLaMain();
      }
    })();
    const lignes = [ENTETE];
    for (let i = 0; i < 1000; i++) lignes.push(`BIEN;Article ${i};;100;;0;;`);

    await importerCatalogueCsvCedant(db, siteId, lignes.join("\n"), userId, { lignesParTranche: 50 });
    actif = false;
    await autreRequete;

    expect(tours).toBeGreaterThanOrEqual(15); // 20 tranches de 50 lignes
  });

  it("par défaut, des tranches de 200 lignes : 1 000 lignes laissent passer au moins 4 pauses", async () => {
    const { db, siteId, userId } = environnement();
    let tours = 0;
    let actif = true;
    const autreRequete = (async () => {
      while (actif) {
        tours += 1;
        await cederLaMain();
      }
    })();
    const lignes = [ENTETE];
    for (let i = 0; i < 1000; i++) lignes.push(`BIEN;Article ${i};;100;;0;;`);

    await importerCatalogueCsvCedant(db, siteId, lignes.join("\n"), userId);
    actif = false;
    await autreRequete;

    expect(tours).toBeGreaterThanOrEqual(4);
  });
});

describe("route d'import du catalogue : ne bloque plus le serveur", () => {
  it("6 000 lignes : le résultat est le même et les autres requêtes passent pendant l'import", async () => {
    const { db, siteId } = environnement();
    creerUtilisateur(db, { siteId, nom: "G", prenom: "G", identifiant: "gerant", motDePasse: "motdepasse-secret", role: "GERANT" });
    const app = buildApp(db, { jwtSecret: "secret-de-test" });
    const token = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "gerant", motDePasse: "motdepasse-secret" } })).json().token;
    const lignes = [ENTETE];
    for (let i = 0; i < 6000; i++) lignes.push(`BIEN;Article ${i};Accessoires;${1000 + i};${500 + i};1;5;`);

    let tours = 0;
    let actif = true;
    const autreRequete = (async () => {
      while (actif) {
        tours += 1;
        await cederLaMain();
      }
    })();
    const reponse = await app.inject({ method: "POST", url: "/api/v1/produits/import-csv", headers: { authorization: `Bearer ${token}` }, payload: { contenuCsv: lignes.join("\n") } });
    actif = false;
    await autreRequete;

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toMatchObject({ crees: 6000, misAJour: 0, erreurs: [] });
    expect(db.select().from(schema.produit).all()).toHaveLength(6000);
    expect(tours).toBeGreaterThanOrEqual(25); // 30 tranches de 200 lignes
  }, 120000);
});
