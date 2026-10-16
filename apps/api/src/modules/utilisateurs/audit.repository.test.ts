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

// Constaté en test grandeur nature (copie de la base, 100 000 lignes d'audit) : la liste n'était pas bornée — 51 Mo
// de JSON et 100 000 lignes à afficher, contre 104 Ko pour une page de 200.
describe("listerJournalAudit : pagination (11.5)", () => {
  // la préparation commune écrit déjà une ligne d'audit (création de l'utilisateur) : comptes exacts ici
  beforeEach(() => {
    db.delete(schema.journalAudit).run();
  });

  function remplir(nombre: number, tableCible = "produit") {
    const valeurs = Array.from({ length: nombre }, (_, i) => ({ utilisateurId: userId, action: "MODIFICATION" as const, tableCible, idCible: String(i) }));
    for (let debut = 0; debut < valeurs.length; debut += 500) db.insert(schema.journalAudit).values(valeurs.slice(debut, debut + 500)).run();
  }

  it("ne renvoie par défaut que les 200 entrées les plus récentes", () => {
    remplir(250);

    const journal = listerJournalAudit(db);

    expect(journal).toHaveLength(200);
    expect(journal[0].idCible).toBe("249");
    expect(journal[199].idCible).toBe("50");
  });

  it("respecte la limite demandée, plafonnée à 1 000", () => {
    remplir(1100);

    expect(listerJournalAudit(db, { limite: 10 })).toHaveLength(10);
    expect(listerJournalAudit(db, { limite: 5000 })).toHaveLength(1000);
  });

  it("remonte dans le temps avec avantId : uniquement des entrées plus anciennes, sans doublon ni trou", () => {
    remplir(450);
    const page1 = listerJournalAudit(db, { limite: 200 });
    const page2 = listerJournalAudit(db, { limite: 200, avantId: page1[page1.length - 1].idAudit });
    const page3 = listerJournalAudit(db, { limite: 200, avantId: page2[page2.length - 1].idAudit });

    expect([page1.length, page2.length, page3.length]).toEqual([200, 200, 50]);
    const ids = [...page1, ...page2, ...page3].map((e) => e.idAudit);
    expect(new Set(ids).size).toBe(450);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it("combine le filtre par table et la pagination", () => {
    remplir(30, "abonne");
    remplir(30, "produit");

    const page = listerJournalAudit(db, { tableCible: "abonne", limite: 20 });
    const suite = listerJournalAudit(db, { tableCible: "abonne", limite: 20, avantId: page[page.length - 1].idAudit });

    expect(page.every((e) => e.tableCible === "abonne")).toBe(true);
    expect([page.length, suite.length]).toEqual([20, 10]);
  });

  it.each([0, -1, 1.5, "abc", null])("refuse une limite invalide (%s)", (limite) => {
    expect(() => listerJournalAudit(db, { limite: limite as never })).toThrow(/limite/i);
  });

  it("refuse un curseur avantId invalide", () => {
    expect(() => listerJournalAudit(db, { avantId: "abc" as never })).toThrow(/avantId|curseur/i);
  });
});
