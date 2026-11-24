import { describe, it, expect, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { joursAvantEcheance } from "@mboapilot/shared";
import { creerDbTest } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { listerProduitsRotationLente } from "./stock.service.js";

// Test grandeur nature (5 000 articles, 200 000 mouvements) : l'écran « rotation lente » relisait les mouvements de chaque article
// l'un après l'autre, sur une table sans index — 83 secondes pendant lesquelles plus personne n'était servi. Le calcul se fait
// maintenant en une seule lecture groupée. Ces tests figent d'abord le résultat (comparé à l'ancien calcul, article par article),
// puis le nombre de requêtes, qui ne dépend plus du nombre d'articles.

const TYPES = ["ACHAT", "VENTE", "CASSE", "TRANSFERT_ENTREE", "TRANSFERT_SORTIE", "INVENTAIRE", "RETOUR_CLIENT"] as const;

function generateur(graine: number) {
  let etat = graine;
  return (n: number) => {
    etat = (etat * 1664525 + 1013904223) % 4294967296;
    return Math.floor((etat / 4294967296) * n);
  };
}

// l'ancien calcul, tel qu'il était écrit : une lecture des mouvements par article
function calculDeReference(db: ReturnType<typeof creerDbTest>, siteId: number, aujourdHui: string) {
  const produits = db
    .select()
    .from(schema.produit)
    .where(and(eq(schema.produit.siteId, siteId), eq(schema.produit.suiviStock, 1)))
    .all()
    .filter((p) => p.quantiteStock > 0);
  return produits
    .map((produit) => {
      const mouvements = db.select().from(schema.stockMouvement).where(eq(schema.stockMouvement.idProduit, produit.idProduit)).all();
      const plusRecente = (types: string[]) => mouvements.filter((m) => types.includes(m.typeMouvement)).map((m) => m.dateMouvement).sort().at(-1) ?? null;
      const derniereVente = plusRecente(["VENTE"]);
      const jours = (date: string | null) => (date !== null ? -joursAvantEcheance(date.slice(0, 10), aujourdHui) : null);
      const joursDepuisDerniereVente = jours(derniereVente);
      const joursDepuisReception = jours(plusRecente(["ACHAT", "TRANSFERT_ENTREE"]));
      const joursSansActivite =
        joursDepuisDerniereVente === null ? joursDepuisReception : joursDepuisReception === null ? joursDepuisDerniereVente : Math.min(joursDepuisDerniereVente, joursDepuisReception);
      return { produit, derniereVente, joursDepuisDerniereVente, joursSansActivite };
    })
    .filter((p) => p.joursSansActivite === null || p.joursSansActivite >= 30)
    .sort((a, b) => (b.joursDepuisDerniereVente ?? Infinity) - (a.joursDepuisDerniereVente ?? Infinity))
    .map(({ produit, derniereVente, joursDepuisDerniereVente }) => ({ produit, derniereVente, joursDepuisDerniereVente }));
}

function preparerBoutique(nombreProduits: number, nombreMouvements: number) {
  const db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  const autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  const userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" })
    .returning()
    .get().idUser;
  const alea = generateur(2026);
  const ids: number[] = [];
  for (let i = 0; i < nombreProduits; i++) {
    ids.push(
      db
        .insert(schema.produit)
        .values({
          siteId: i % 7 === 0 ? autreSiteId : siteId, // quelques articles de l'autre boutique
          type: "BIEN",
          libelle: `Article ${i}`,
          prixVente: 1000,
          suiviStock: i % 11 === 0 ? 0 : 1, // quelques articles non suivis
          quantiteStock: i % 5 === 0 ? 0 : 1 + alea(20), // quelques articles sans stock
        })
        .returning()
        .get().idProduit,
    );
  }
  for (let i = 0; i < nombreMouvements; i++) {
    const jour = 1 + alea(120);
    const date = new Date(Date.UTC(2026, 0, 31) - jour * 86_400_000).toISOString().slice(0, 10);
    db.insert(schema.stockMouvement)
      .values({
        idProduit: ids[alea(ids.length)],
        siteId,
        typeMouvement: TYPES[alea(TYPES.length)],
        quantite: 1 + alea(5),
        utilisateurId: userId,
        dateMouvement: `${date} ${String(alea(24)).padStart(2, "0")}:00:00`,
      })
      .run();
  }
  return { db, siteId };
}

describe("listerProduitsRotationLente à grand volume", () => {
  it("rend exactement le résultat de l'ancien calcul, article par article (types, ex æquo, articles sans mouvement, autre boutique)", () => {
    const { db, siteId } = preparerBoutique(140, 700);
    const attendu = calculDeReference(db, siteId, "2026-01-31");
    const obtenu = listerProduitsRotationLente(db, siteId, "2026-01-31");

    expect(attendu.length).toBeGreaterThan(10); // le jeu d'essai contient de vrais cas
    expect(attendu.length).toBeLessThan(120); // et en écarte aussi
    expect(attendu.some((r) => r.derniereVente === null)).toBe(true);
    expect(attendu.some((r) => r.derniereVente !== null)).toBe(true);
    expect(obtenu).toEqual(attendu);
  });

  it("n'envoie qu'un nombre fixe de requêtes, quel que soit le nombre d'articles", () => {
    const { db, siteId } = preparerBoutique(300, 600);
    const prepare = vi.spyOn(db.$client, "prepare");

    listerProduitsRotationLente(db, siteId, "2026-01-31");

    expect(prepare.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
