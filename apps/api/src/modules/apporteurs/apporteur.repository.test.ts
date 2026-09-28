import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import {
  creerApporteur,
  enregistrerReglementCommission,
  listerApporteurs,
  listerReglementsApporteur,
  modifierApporteur,
  trouverApporteur,
} from "./apporteur.repository.js";

let db: Db;
let userId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "GERANT" })
    .returning()
    .get().idUser;
});

describe("creerApporteur / trouverApporteur / listerApporteurs (6.3)", () => {
  it("crée un apporteur actif par défaut", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur", telephone: "690000000", tauxCommissionDefaut: 500 });

    expect(apporteur.actif).toBe(1);
    expect(trouverApporteur(db, apporteur.idApporteur)?.nom).toBe("Jean Apporteur");
    expect(listerApporteurs(db)).toHaveLength(1);
  });

  it("exige un nom", () => {
    expect(() => creerApporteur(db, { nom: "" })).toThrow(/nom/i);
    expect(() => creerApporteur(db, { nom: "   " })).toThrow(/nom/i);
  });

  // 6.2, 6.3 : un taux négatif produirait une commission négative (montant
  // "dû" qui n'a aucun sens), venant fausser calculerSoldeCommission dès
  // qu'un recrutement confirmé l'utilise
  it("rejette un taux de commission par défaut négatif", () => {
    expect(() => creerApporteur(db, { nom: "Jean Apporteur", tauxCommissionDefaut: -50 })).toThrow(/négatif|positif/i);
  });
});

describe("modifierApporteur", () => {
  it("permet de désactiver un apporteur et de changer son taux", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur" });

    modifierApporteur(db, apporteur.idApporteur, { actif: false, tauxCommissionDefaut: 1000 });

    const misAJour = trouverApporteur(db, apporteur.idApporteur);
    expect(misAJour?.actif).toBe(0);
    expect(misAJour?.tauxCommissionDefaut).toBe(1000);
  });

  it("rejette un taux de commission négatif", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur" });
    expect(() => modifierApporteur(db, apporteur.idApporteur, { tauxCommissionDefaut: -10 })).toThrow(/négatif|positif/i);
  });
});

// 6.3 : "historique de règlement de ses commissions" sur la fiche apporteur
describe("enregistrerReglementCommission / listerReglementsApporteur (6.3)", () => {
  it("enregistre un règlement et le retrouve dans l'historique de l'apporteur", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur" });

    enregistrerReglementCommission(db, { apporteurId: apporteur.idApporteur, montant: 15000, modePaiement: "CASH", utilisateurId: userId });

    const reglements = listerReglementsApporteur(db, apporteur.idApporteur);
    expect(reglements).toHaveLength(1);
    expect(reglements[0].montant).toBe(15000);
    expect(reglements[0].modePaiement).toBe("CASH");
  });

  it("conserve la référence de virement/chèque quand elle est fournie", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur" });

    enregistrerReglementCommission(db, {
      apporteurId: apporteur.idApporteur,
      montant: 20000,
      modePaiement: "VIREMENT",
      reference: "VIR-2026-000042",
      utilisateurId: userId,
    });

    expect(listerReglementsApporteur(db, apporteur.idApporteur)[0].reference).toBe("VIR-2026-000042");
  });

  it("ne renvoie que les règlements de l'apporteur demandé", () => {
    const apporteur1 = creerApporteur(db, { nom: "Jean Apporteur" });
    const apporteur2 = creerApporteur(db, { nom: "Marie Apporteuse" });
    enregistrerReglementCommission(db, { apporteurId: apporteur1.idApporteur, montant: 5000, modePaiement: "CASH", utilisateurId: userId });
    enregistrerReglementCommission(db, { apporteurId: apporteur2.idApporteur, montant: 7000, modePaiement: "CASH", utilisateurId: userId });

    expect(listerReglementsApporteur(db, apporteur1.idApporteur)).toHaveLength(1);
    expect(listerReglementsApporteur(db, apporteur1.idApporteur)[0].montant).toBe(5000);
  });
});
