import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerFixtureEtatVentes, type FixtureEtatVentes } from "../../test-utils/fixture-etat-ventes.js";
import { cederLaMain } from "../../lib/ceder-la-main.js";
import { construireEtatVentes, construireEtatVentesCedant, decouperEnTranches, joursParTranchePourVolume } from "./etat-ventes.service.js";

// Constaté en test de charge (un an, 25 000 factures) : fabriquer l'état d'une longue période bloquait le serveur près de 3 secondes, sans répondre aux
// autres requêtes (un caissier qui encaisse au même moment attendait). L'état se calcule donc par tranches de quelques jours, avec une pause entre
// chaque pour laisser passer les autres requêtes. Le résultat doit rester EXACTEMENT celui du calcul d'un seul bloc.
let db: Db;
let fx: FixtureEtatVentes;
const MAINTENANT = new Date("2026-11-17T14:21:00.000Z");

beforeEach(() => {
  db = creerDbTest();
  fx = creerFixtureEtatVentes(db);
});

describe("decouperEnTranches", () => {
  it("découpe la période en tranches contiguës de N jours, la dernière plus courte, sans trou ni recouvrement", () => {
    expect(decouperEnTranches({ du: "2026-11-01", au: "2026-11-17" }, 7)).toEqual([
      { du: "2026-11-01", au: "2026-11-07" },
      { du: "2026-11-08", au: "2026-11-14" },
      { du: "2026-11-15", au: "2026-11-17" },
    ]);
  });

  it("une période plus courte que la tranche, ou d'un seul jour, reste en une seule tranche", () => {
    expect(decouperEnTranches({ du: "2026-11-01", au: "2026-11-03" }, 7)).toEqual([{ du: "2026-11-01", au: "2026-11-03" }]);
    expect(decouperEnTranches({ du: "2026-11-17", au: "2026-11-17" }, 7)).toEqual([{ du: "2026-11-17", au: "2026-11-17" }]);
  });

  it("passe d'un mois à l'autre et d'une année à l'autre sans perdre de jour", () => {
    const tranches = decouperEnTranches({ du: "2026-12-28", au: "2027-01-05" }, 4);

    expect(tranches).toEqual([
      { du: "2026-12-28", au: "2026-12-31" },
      { du: "2027-01-01", au: "2027-01-04" },
      { du: "2027-01-05", au: "2027-01-05" },
    ]);
  });
});

describe("construireEtatVentesCedant : le même état, calculé par tranches", () => {
  // novembre (fixture complète : minuit de Douala, avoir, remboursement, impayé, brouillon, autre boutique) puis une période qui déborde sur décembre
  // (le solde de F2 et la facture de décembre y entrent) : un avoir, un solde ou un remboursement tombent dans une autre tranche que leur vente
  it.each([
    ["novembre", { du: "2026-11-01", au: "2026-11-30" }],
    ["novembre et décembre", { du: "2026-11-01", au: "2026-12-31" }],
    ["un seul jour", { du: "2026-11-04", au: "2026-11-04" }],
    ["une période sans vente", { du: "2026-01-01", au: "2026-01-31" }],
  ])("%s : identique au calcul d'un seul bloc, quelle que soit la taille des tranches", async (_nom, periode) => {
    const attendu = construireEtatVentes(db, fx.siteId, periode, { maintenant: MAINTENANT });

    for (const joursParTranche of [1, 2, 7, 31, 400]) {
      const etat = await construireEtatVentesCedant(db, fx.siteId, periode, { maintenant: MAINTENANT, joursParTranche });
      expect(etat, `tranches de ${joursParTranche} jour(s)`).toEqual(attendu);
    }
  });

  it("l'autre boutique et la limite de détail donnent aussi le même état", async () => {
    const periode = { du: "2026-11-01", au: "2026-12-31" };

    expect(await construireEtatVentesCedant(db, fx.autreSiteId, periode, { maintenant: MAINTENANT, joursParTranche: 3 })).toEqual(
      construireEtatVentes(db, fx.autreSiteId, periode, { maintenant: MAINTENANT }),
    );
    expect(await construireEtatVentesCedant(db, fx.siteId, periode, { maintenant: MAINTENANT, joursParTranche: 3, limiteDetail: 2 })).toEqual(
      construireEtatVentes(db, fx.siteId, periode, { maintenant: MAINTENANT, limiteDetail: 2 }),
    );
  });

  it("par défaut, des tranches dont la taille s'adapte au volume de la période", async () => {
    const periode = { du: "2026-11-01", au: "2026-11-30" };

    expect(await construireEtatVentesCedant(db, fx.siteId, periode, { maintenant: MAINTENANT })).toEqual(construireEtatVentes(db, fx.siteId, periode, { maintenant: MAINTENANT }));
  });

  it("refuse une période invalide, inversée ou trop longue, avec les mêmes messages", async () => {
    await expect(construireEtatVentesCedant(db, fx.siteId, { du: "2026-11-30", au: "2026-11-01" })).rejects.toThrow(/inversée/);
    await expect(construireEtatVentesCedant(db, fx.siteId, { du: "2026-02-30", au: "2026-03-01" })).rejects.toThrow(/date de début/);
    await expect(construireEtatVentesCedant(db, fx.siteId, { du: "2025-01-01", au: "2026-11-30" })).rejects.toThrow(/trop longue/);
  });

  it("rend la main au serveur entre deux tranches : les autres requêtes peuvent passer", async () => {
    // une « autre requête » qui ne demande qu'un tour de boucle d'événements : elle n'avance que si le calcul cède la main
    let tours = 0;
    let actif = true;
    const autreRequete = (async () => {
      while (actif) {
        tours += 1;
        await cederLaMain();
      }
    })();

    await construireEtatVentesCedant(db, fx.siteId, { du: "2026-11-01", au: "2026-11-30" }, { joursParTranche: 1 });
    actif = false;
    await autreRequete;

    expect(tours).toBeGreaterThanOrEqual(25); // 30 tranches d'un jour
  });
});

// Chaque tranche coûte ~30 ms de frais fixes (mesuré sur un an de ventes : des tranches d'un jour font passer le calcul de 1,2 s à 11,8 s) mais ne
// bloque le serveur que le temps de son contenu. La taille se règle donc sur le volume : environ 2 500 factures par tranche, d'un à 31 jours.
describe("joursParTranchePourVolume", () => {
  it.each([
    [0, 366, 31], // rien à calculer : tranches d'un mois
    [6, 30, 31], // la fixture : une boutique calme
    [25_000, 366, 31], // 70 factures par jour : un mois tient dans la cible, et on ne dépasse jamais 31 jours
    [100_000, 366, 9], // 273 factures par jour : 9 jours de ventes par tranche
    [400_000, 366, 2],
    [10_000_000, 366, 1], // jamais moins d'un jour
  ])("%i factures sur %i jours : tranches de %i jour(s)", (factures, jours, attendu) => {
    expect(joursParTranchePourVolume(factures, jours)).toBe(attendu);
  });
});
