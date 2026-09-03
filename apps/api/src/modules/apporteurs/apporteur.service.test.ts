import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { recruterAbonne } from "../abonnements/recrutement.service.js";
import { creerApporteur } from "./apporteur.repository.js";
import { construireFicheApporteur } from "./apporteur.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idFormuleCanal: number;
let idFormuleDstv: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" })
    .returning()
    .get().idUser;
  const canal = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  const dstv = db.insert(schema.familleAbonnement).values({ libelle: "DSTV" }).returning().get();
  idFormuleCanal = db.insert(schema.formule).values({ idFamille: canal.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
  idFormuleDstv = db.insert(schema.formule).values({ idFamille: dstv.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 }).returning().get().idFormule;
});

describe("construireFicheApporteur (6.3)", () => {
  it("consolide les abonnés référés, le chiffre d'affaires et les commissions CANAL+", () => {
    const apporteur = creerApporteur(db, { nom: "Jean Apporteur", tauxCommissionDefaut: 500 });

    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: idFormuleCanal,
      montantEncaisse: 10500,
      apporteurId: apporteur.idApporteur,
    });
    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Mballa", prenom: "Sylvie", telephone: "690000001" },
      idFormule: idFormuleDstv,
      montantEncaisse: 13000,
      apporteurId: apporteur.idApporteur,
    });
    // abonné non référé par cet apporteur — ne doit apparaître nulle part dans la fiche
    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Fotso", prenom: "Eric", telephone: "690000002" },
      idFormule: idFormuleDstv,
      montantEncaisse: 13000,
    });

    const fiche = construireFicheApporteur(db, apporteur.idApporteur);

    expect(fiche.apporteur.idApporteur).toBe(apporteur.idApporteur);
    expect(fiche.abonnes).toHaveLength(2);
    expect(fiche.chiffreAffaires).toBe(23500); // 10500 + 13000
    expect(fiche.commissionsCanalplus).toHaveLength(1);
    expect(fiche.commissionsCanalplus[0].statut).toBe("EN_COURS");
    expect(fiche.commissionsCanalplus[0].montantCommission).toBe(5250); // 50 % (taux de l'apporteur) de 10500
  });

  it("rejette un apporteur inconnu", () => {
    expect(() => construireFicheApporteur(db, 999999)).toThrow(/introuvable/);
  });
});
