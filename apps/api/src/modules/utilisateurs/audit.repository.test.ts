import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerUtilisateur } from "./utilisateur.repository.js";
import { listerJournalAudit } from "./audit.repository.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" }).idUser;
});

describe("listerJournalAudit (11.5, 8.7)", () => {
  it("liste les entrées, la plus récente en tête, avec l'identité de l'auteur", () => {
    db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "SUPPRESSION", tableCible: "abonne", idCible: "1" }).run();
    db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "MODIFICATION", tableCible: "produit", idCible: "5" }).run();

    const journal = listerJournalAudit(db);

    expect(journal).toHaveLength(2);
    expect(journal[0].tableCible).toBe("produit");
    expect(journal[0].utilisateurNom).toBe("Nga");
  });

  it("filtre par table cible", () => {
    db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "SUPPRESSION", tableCible: "abonne", idCible: "1" }).run();
    db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "MODIFICATION", tableCible: "produit", idCible: "5" }).run();

    const journal = listerJournalAudit(db, { tableCible: "abonne" });

    expect(journal).toHaveLength(1);
    expect(journal[0].tableCible).toBe("abonne");
  });
});
