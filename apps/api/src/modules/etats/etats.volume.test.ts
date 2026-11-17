import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerFixtureEtatVentes, type FixtureEtatVentes } from "../../test-utils/fixture-etat-ventes.js";
import * as schema from "../../db/schema.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";

// Volume : au-delà de 5 000 factures, le détail de l'écran, du PDF et du JSON est coupé, mais le CSV (le recours que l'avertissement propose) ne l'est jamais.

const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";
const MOT_DE_PASSE = "motdepasse-secret";
const QUERY = "du=2026-11-01&au=2026-11-30";
const NOMBRE_INSEREES = 5001;
const TAILLE_LOT = 500;
const AVERTISSEMENT = "Détail limité aux 5 000 premières factures : réduisez la période ou utilisez le CSV.";
const TOTAL_TTC_FIXTURE = 24900;
const ENCAISSE_FIXTURE = 21900; // paiements reçus à ce jour sur les factures de novembre de la fixture
const RESTE_FIXTURE = 3000; // F5 : 4 000 facturés, 1 000 encaissés

let db: Db;
let app: FastifyInstance;
let jeton: string;
let sommeInseree = 0;

const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${jeton}` } });

beforeAll(async () => {
  db = creerDbTest();
  const fx: FixtureEtatVentes = creerFixtureEtatVentes(db);
  creerUtilisateur(db, { siteId: fx.siteId, nom: "Gerant", prenom: "Test", identifiant: "gerant", motDePasse: MOT_DE_PASSE, role: "GERANT" });

  // insertion en masse, par lots, dans une seule transaction : petits montants, sans ligne de vente ni paiement
  db.transaction((tx) => {
    for (let debut = 0; debut < NOMBRE_INSEREES; debut += TAILLE_LOT) {
      const lot = [];
      for (let i = debut; i < Math.min(debut + TAILLE_LOT, NOMBRE_INSEREES); i++) {
        const montant = 10 + (i % 7);
        sommeInseree += montant;
        lot.push({ siteId: fx.siteId, idAbonne: fx.idAbonne, creePar: fx.userId, statut: "VALIDEE" as const, montantTaxe: 0, montantTotal: montant, dateCreation: "2026-11-20 10:00:00" });
      }
      tx.insert(schema.facture).values(lot).run();
    }
  });

  app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "gerant", motDePasse: MOT_DE_PASSE } });
  jeton = reponse.json().token as string;
}, 120_000);

describe("état des ventes au-delà de 5 000 factures", () => {
  it("JSON : détail limité à 5 000 lignes, avertissement, pas de totaux du détail, totaux de la période sur TOUTES les factures", async () => {
    const reponse = await get(`/api/v1/etats/ventes?${QUERY}`);
    expect(reponse.statusCode).toBe(200);
    const etat = reponse.json();

    const detail = etat.sections.find((s: { titre: string }) => s.titre === "Détail facture par facture");
    expect(detail.lignes).toHaveLength(5000);
    expect(detail.totaux).toBeUndefined();
    expect(etat.avertissements).toEqual([AVERTISSEMENT]);

    const totaux = etat.sections.find((s: { titre: string }) => s.titre === "Totaux de la période");
    expect(totaux.lignes[0]).toEqual(["Total TTC (net des avoirs)", TOTAL_TTC_FIXTURE + sommeInseree]);
  }, 120_000);

  it("CSV : jamais limité (toutes les lignes de détail, aucun avertissement, ligne de totaux du détail)", async () => {
    const reponse = await get(`/api/v1/etats/ventes/csv?${QUERY}`);
    expect(reponse.statusCode).toBe(200);
    const lignes = reponse.body.split("\r\n");

    const lignesDeFacture = lignes.filter((l) => /^\d{2}\/\d{2}\/\d{4};\d+;(Vente|Avoir);/.test(l));
    expect(lignesDeFacture).toHaveLength(6 + NOMBRE_INSEREES);
    expect(lignes.some((l) => l.startsWith("Avertissement"))).toBe(false);
    expect(reponse.body).not.toContain("Infinity");
    expect(lignes).toContain(`Total;;;;;${TOTAL_TTC_FIXTURE + sommeInseree};${ENCAISSE_FIXTURE};${RESTE_FIXTURE + sommeInseree}`);
  }, 120_000);
});
