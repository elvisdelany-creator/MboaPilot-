import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerSuiviCommissionCanalplus } from "./suivi-commission-canalplus.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let numeroAbonnement: number;
let userId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  const formule = db.insert(schema.formule).values({ idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get();
  const abonne = db.insert(schema.abonne).values({ siteId, nom: "Client", prenom: "Test", telephone: "690000000" }).returning().get();
  numeroAbonnement = db
    .insert(schema.abonnement)
    .values({ idAbonne: abonne.idAbonne, idFormule: formule.idFormule, siteId, dateDebut: "2026-09-15", dateFin: "2026-10-14", creePar: userId })
    .returning()
    .get().numeroAbonnement;
});

// 6.2 : point d'insertion unique du suivi de commission CANAL+, appelé
// aussi bien au paiement immédiat (recrutement.service.ts) qu'à la
// confirmation différée d'un paiement mobile (paiement-mobile.service.ts)
describe("creerSuiviCommissionCanalplus (6.2)", () => {
  it("crée un suivi EN_COURS avec les valeurs fournies", () => {
    creerSuiviCommissionCanalplus(db, {
      numeroAbonnement,
      vendeurId: userId,
      apporteurId: undefined,
      montantCommission: 2900,
      dateFinProbatoire: "2027-01-12",
    });

    const suivi = db.select().from(schema.suiviCommissionCanalplus).where(eq(schema.suiviCommissionCanalplus.numeroAbonnement, numeroAbonnement)).get();
    expect(suivi?.statut).toBe("EN_COURS");
    expect(suivi?.montantCommission).toBe(2900);
    expect(suivi?.dateFinProbatoire).toBe("2027-01-12");
    expect(suivi?.vendeurId).toBe(userId);
    expect(suivi?.apporteurId).toBeNull();
  });
});
