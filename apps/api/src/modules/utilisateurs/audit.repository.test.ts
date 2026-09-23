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

    // + 1 : la création du compte "Nga" au beforeEach journalise déjà elle-même
    expect(journal).toHaveLength(3);
    expect(journal[0].tableCible).toBe("produit");
    expect(journal[0].utilisateurNom).toBe("Nga");
  });

  // 11.3, 11.5 : une action système (ex. anonymisation automatique par le
  // job quotidien, historique_abonnement.utilisateur_id = NULL) est bien
  // journalisée mais utilisateur_id y reste NULL — un INNER JOIN sur
  // utilisateur exclurait silencieusement ces entrées de la consultation,
  // cachant précisément les actions les plus sensibles à tracer.
  it("inclut les entrées d'une action système (auteur NULL, ex. anonymisation automatique)", () => {
    db.insert(schema.journalAudit).values({ utilisateurId: null, action: "SUPPRESSION", tableCible: "abonne", idCible: "42" }).run();
    db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "MODIFICATION", tableCible: "produit", idCible: "5" }).run();

    const journal = listerJournalAudit(db);

    // + 1 : la création du compte "Nga" au beforeEach journalise déjà elle-même
    expect(journal).toHaveLength(3);
    const entreeSysteme = journal.find((e) => e.idCible === "42");
    expect(entreeSysteme).toBeDefined();
    expect(entreeSysteme?.utilisateurId).toBeNull();
    expect(entreeSysteme?.utilisateurNom).toBeNull();
  });

  it("filtre par table cible", () => {
    db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "SUPPRESSION", tableCible: "abonne", idCible: "1" }).run();
    db.insert(schema.journalAudit).values({ utilisateurId: userId, action: "MODIFICATION", tableCible: "produit", idCible: "5" }).run();

    const journal = listerJournalAudit(db, { tableCible: "abonne" });

    expect(journal).toHaveLength(1);
    expect(journal[0].tableCible).toBe("abonne");
  });
});
