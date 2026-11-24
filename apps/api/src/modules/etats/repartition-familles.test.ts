import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { creerResolveurFamilleLigne } from "../tableau-bord/tableau-bord.service.js";
import { facturesDeLaPeriode } from "../export-comptable/export-comptable.service.js";
import { repartitionFamilles } from "./etat-ventes.service.js";

// Test grandeur nature (100 000 factures sur un an) : l'état des ventes mettait 23 secondes, dont plus de la moitié à retrouver la famille de
// chaque article et de chaque abonnement par des requêtes une à une, refaites à chaque tranche. La répartition se calcule maintenant en une
// seule requête groupée ; elle doit donner exactement les mêmes familles que le résolveur du tableau de bord.

function generateur(graine: number) {
  let etat = graine;
  return (n: number) => {
    etat = (etat * 1664525 + 1013904223) % 4294967296;
    return Math.floor((etat / 4294967296) * n);
  };
}

function preparer(nombreFactures: number) {
  const db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  const autreSite = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  const userId = db.insert(schema.utilisateur).values({ siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  const idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555" }).returning().get().idAbonne;
  const canal = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  const netflix = db.insert(schema.familleAbonnement).values({ libelle: "STREAMING" }).returning().get().idFamille;
  const formules = [canal, netflix].map((idFamille, i) => db.insert(schema.formule).values({ idFamille, libelle: `Formule ${i}`, prix: 5000, rang: 1 }).returning().get().idFormule);
  const abonnements = formules.flatMap((idFormule) =>
    [0, 1, 2].map(() => db.insert(schema.abonnement).values({ idAbonne, idFormule, siteId, dateDebut: "2026-11-01", dateFin: "2026-11-30", creePar: userId }).returning().get().numeroAbonnement),
  );
  const kits = [canal, netflix].map((idFamille) => db.insert(schema.kit).values({ idFamille, libelle: "Kit", reglePrix: "PRIX_FIXE", prixFixe: 20000 }).returning().get().idKit);
  const option = db.insert(schema.optionComplement).values({ libelle: "Option English", prix: 2000 }).returning().get().idOption;
  const produits = (["BIEN", "BIEN", "SERVICE", "SAV"] as const).map((type, i) => db.insert(schema.produit).values({ siteId, type, libelle: `Article ${i}`, prixVente: 1000 }).returning().get().idProduit);
  const alea = generateur(11);
  const facturesSav: number[] = [];
  for (let i = 0; i < nombreFactures; i++) {
    const jour = 1 + alea(30);
    const date = `2026-11-${String(jour).padStart(2, "0")} ${String(alea(23)).padStart(2, "0")}:00:00`;
    const f = db
      .insert(schema.facture)
      .values({ siteId: i % 9 === 0 ? autreSite : siteId, idAbonne, creePar: userId, statut: i % 10 === 0 ? "BROUILLON" : "VALIDEE", montantTotal: 1000, dateCreation: date })
      .returning()
      .get();
    for (let l = 0; l < 1 + alea(3); l++) {
      // toutes les natures de ligne, y compris les combinaisons (abonnement + kit, abonnement + option) et la ligne sans rien (« Autre »)
      const nature = alea(8);
      db.insert(schema.ligneVente)
        .values({
          idFacture: f.idFacture,
          numeroAbonnement: nature === 0 || nature === 1 ? abonnements[alea(abonnements.length)] : null,
          idKit: nature === 1 || nature === 2 ? kits[alea(kits.length)] : null,
          idOption: nature === 3 ? option : null,
          idProduit: nature >= 4 && nature <= 6 ? produits[alea(produits.length)] : null,
          quantite: 1 + alea(3),
          prixApplique: alea(5) === 0 ? -500 : 700 + alea(5) * 100,
        })
        .run();
    }
    // quelques factures de dossier SAV : tout leur chiffre d'affaires est du SAV, quelle que soit la nature des lignes
    if (i % 7 === 0 && f.statut === "VALIDEE") {
      db.insert(schema.savDossier).values({ siteId, idAbonne, descriptionPanne: "Panne", idFacture: f.idFacture }).run();
      facturesSav.push(f.idFacture);
    }
  }
  return { db, siteId, facturesSav };
}

const PERIODE = { du: "2026-11-05", au: "2026-11-25" };

describe("repartitionFamilles : calcul groupé", () => {
  it("rend exactement les familles du résolveur du tableau de bord, ligne par ligne", () => {
    const { db, siteId, facturesSav } = preparer(400);
    const lignes = db
      .select({ ligne: schema.ligneVente })
      .from(schema.ligneVente)
      .innerJoin(schema.facture, eq(schema.ligneVente.idFacture, schema.facture.idFacture))
      .where(facturesDeLaPeriode(db, siteId, PERIODE))
      .all();
    const resoudre = creerResolveurFamilleLigne(db);
    const attendu = new Map<string, number>();
    for (const { ligne } of lignes) attendu.set(resoudre(ligne), (attendu.get(resoudre(ligne)) ?? 0) + ligne.prixApplique);

    expect(facturesSav.length).toBeGreaterThan(10);
    expect([...attendu.keys()].sort()).toEqual(["Autre", "CANAL+", "Produits & Services", "SAV", "STREAMING"]); // toutes les familles sont exercées
    expect(Object.fromEntries(repartitionFamilles(db, siteId, PERIODE))).toEqual(Object.fromEntries(attendu));
  });

  it("n'envoie qu'un nombre fixe de requêtes, quel que soit le nombre de lignes", () => {
    const { db, siteId } = preparer(300);
    const prepare = vi.spyOn(db.$client, "prepare");

    repartitionFamilles(db, siteId, PERIODE);

    expect(prepare.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("une période sans vente donne une répartition vide", () => {
    const { db, siteId } = preparer(20);
    expect(repartitionFamilles(db, siteId, { du: "2030-01-01", au: "2030-01-31" }).size).toBe(0);
  });
});
