import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { obtenirOuCreerLicence, revaliderLicence, calculerEtatLicence, prolongerLicence, DELAI_GRACE_JOURS } from "./licence.service.js";
import { eq } from "drizzle-orm";
import * as schema from "../../db/schema.js";

let db: Db;

beforeEach(() => {
  db = creerDbTest();
});

describe("obtenirOuCreerLicence (10.4)", () => {
  it("crée une licence par défaut (palier Essentiel) au premier accès, avec une empreinte d'installation stable", () => {
    const premiere = obtenirOuCreerLicence(db, "2026-09-09T08:00:00.000Z");
    const seconde = obtenirOuCreerLicence(db, "2026-09-09T09:00:00.000Z");

    expect(premiere.palier).toBe("ESSENTIEL");
    expect(premiere.empreinteInstallation).toEqual(seconde.empreinteInstallation);
    expect(premiere.idLicence).toBe(seconde.idLicence);
  });
});

describe("revaliderLicence (10.4)", () => {
  it("simule une revalidation périodique réussie et avance la date de dernière revalidation", () => {
    obtenirOuCreerLicence(db, "2026-08-01T08:00:00.000Z");

    const revalidee = revaliderLicence(db, "2026-09-09T08:00:00.000Z");

    expect(revalidee.derniereRevalidationReussie.slice(0, 10)).toBe("2026-09-09");
  });
});

describe("calculerEtatLicence (10.4)", () => {
  const licenceBase = {
    palier: "ESSENTIEL",
    empreinteInstallation: "abc-123",
    dateExpirationAbonnement: "2027-01-01",
    derniereRevalidationReussie: "2026-09-09T08:00:00.000Z",
  };

  it("reste ACTIVE le jour même de la revalidation", () => {
    const statut = calculerEtatLicence(licenceBase, "2026-09-09T10:00:00.000Z");
    expect(statut.etat).toBe("ACTIVE");
    expect(statut.joursRestantsGrace).toBe(DELAI_GRACE_JOURS);
  });

  it(`reste ACTIVE dans les ${DELAI_GRACE_JOURS} jours du délai de grâce hors ligne sans revalidation`, () => {
    const statut = calculerEtatLicence(licenceBase, "2026-09-25T10:00:00.000Z"); // 16 jours plus tard
    expect(statut.etat).toBe("ACTIVE");
    expect(statut.joursRestantsGrace).toBe(5);
  });

  it("bascule en mode DEGRADE (lecture seule) au-delà du délai de grâce sans revalidation réussie", () => {
    const statut = calculerEtatLicence(licenceBase, "2026-10-05T10:00:00.000Z"); // 26 jours plus tard
    expect(statut.etat).toBe("DEGRADE");
    expect(statut.joursRestantsGrace).toBeLessThan(0);
  });

  it("bascule en mode DEGRADE si l'abonnement éditeur lui-même est expiré, même revalidé récemment", () => {
    const statut = calculerEtatLicence({ ...licenceBase, dateExpirationAbonnement: "2026-09-01" }, "2026-09-09T10:00:00.000Z");
    expect(statut.etat).toBe("DEGRADE");
  });
});

// Décision du 2026-10-19 (pilote) : l'administrateur voit l'échéance de la licence et la prolonge en saisissant une
// nouvelle date. Sans cela, un an après le premier lancement, l'application passait en lecture seule sans issue.
describe("prolongerLicence (10.4)", () => {
  const MAINTENANT = "2026-10-20T10:00:00.000Z";
  let idUser: number;

  beforeEach(() => {
    const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
    const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
    idUser = db.insert(schema.utilisateur).values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" }).returning().get().idUser;
    obtenirOuCreerLicence(db, "2026-01-05T08:00:00.000Z"); // expire le 2027-01-05
  });

  it("repousse la date d'expiration et revalide la licence", () => {
    const licence = prolongerLicence(db, { dateExpiration: "2028-01-05", userId: idUser, maintenant: MAINTENANT });

    expect(licence.dateExpirationAbonnement).toBe("2028-01-05");
    expect(licence.derniereRevalidationReussie.slice(0, 10)).toBe("2026-10-20");
  });

  it("fait sortir du mode dégradé une licence dont l'abonnement avait expiré", () => {
    db.update(schema.licence).set({ dateExpirationAbonnement: "2026-10-01" }).run();
    expect(calculerEtatLicence(obtenirOuCreerLicence(db, MAINTENANT), MAINTENANT).etat).toBe("DEGRADE");

    const licence = prolongerLicence(db, { dateExpiration: "2027-10-20", userId: idUser, maintenant: MAINTENANT });

    expect(calculerEtatLicence(licence, MAINTENANT).etat).toBe("ACTIVE");
  });

  it.each([
    ["une date déjà passée", "2026-10-19"],
    ["aujourd'hui", "2026-10-20"],
    ["une date antérieure à l'échéance actuelle (ce n'est pas une prolongation)", "2026-12-31"],
    ["la même échéance", "2027-01-05"],
    ["une date au-delà de 10 ans", "2037-01-01"],
  ])("refuse %s", (_libelle, date) => {
    expect(() => prolongerLicence(db, { dateExpiration: date, userId: idUser, maintenant: MAINTENANT })).toThrow();
    expect(obtenirOuCreerLicence(db, MAINTENANT).dateExpirationAbonnement).toBe("2027-01-05");
  });

  it.each(["", "demain", "2028-13-40", "05/01/2028", "2028-02-30", 20280105, null, undefined])("refuse une date invalide (%s)", (date) => {
    expect(() => prolongerLicence(db, { dateExpiration: date as never, userId: idUser, maintenant: MAINTENANT })).toThrow(/date/i);
  });

  it("journalise l'ancienne et la nouvelle échéance, au nom de l'administrateur", () => {
    prolongerLicence(db, { dateExpiration: "2028-01-05", userId: idUser, maintenant: MAINTENANT });

    const trace = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "licence")).get()!;
    expect(trace.utilisateurId).toBe(idUser);
    expect(trace.action).toBe("MODIFICATION");
    expect(trace.valeurAvant).toContain("2027-01-05");
    expect(trace.valeurApres).toContain("2028-01-05");
  });
});

describe("calculerEtatLicence : jours restants de l'abonnement (10.4)", () => {
  const base = { palier: "ESSENTIEL", empreinteInstallation: "abc", derniereRevalidationReussie: "2026-10-20T08:00:00.000Z" };

  it("indique les jours restants jusqu'à l'échéance, négatifs une fois dépassée", () => {
    expect(calculerEtatLicence({ ...base, dateExpirationAbonnement: "2026-11-19" }, "2026-10-20T10:00:00.000Z").joursRestantsAbonnement).toBe(30);
    expect(calculerEtatLicence({ ...base, dateExpirationAbonnement: "2026-10-18" }, "2026-10-20T10:00:00.000Z").joursRestantsAbonnement).toBe(-2);
  });
});

