import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { listerAbonnementsParAbonne } from "./abonnement.repository.js";
import { recruterAbonne } from "./recrutement.service.js";
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
  idFormuleCanal = db
    .insert(schema.formule)
    .values({ idFamille: canal.idFamille, libelle: "EVASION", prix: 10500, rang: 2 })
    .returning()
    .get().idFormule;
  idFormuleDstv = db
    .insert(schema.formule)
    .values({ idFamille: dstv.idFamille, libelle: "COMPAQ", prix: 13000, rang: 3 })
    .returning()
    .get().idFormule;
});

describe("listerAbonnementsParAbonne (4.5, 9.2 : détection recrutement vs réabonnement)", () => {
  it("renvoie tous les abonnements d'un abonné, toutes familles confondues", () => {
    const { numeroAbonnement: n1 } = recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" },
      idFormule: idFormuleCanal,
      montantEncaisse: 10500,
    });
    const abonne = db.select().from(schema.abonne).where(eq(schema.abonne.telephone, "690000000")).get();

    recruterAbonne(db, {
      siteId,
      userId,
      aujourdHui: "2025-11-16",
      abonne: { idAbonne: abonne!.idAbonne },
      idFormule: idFormuleDstv,
      montantEncaisse: 13000,
    });

    const abonnements = listerAbonnementsParAbonne(db, abonne!.idAbonne);

    expect(abonnements).toHaveLength(2);
    expect(abonnements.map((a) => a.numeroAbonnement)).toContain(n1);
  });

  it("renvoie un tableau vide pour un abonné sans abonnement", () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "X", prenom: "Y", telephone: "600000000" }).returning().get();

    expect(listerAbonnementsParAbonne(db, abonne.idAbonne)).toHaveLength(0);
  });
});
