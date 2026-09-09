import { describe, it, expect, beforeEach } from "vitest";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { obtenirOuCreerLicence, revaliderLicence, calculerEtatLicence, DELAI_GRACE_JOURS } from "./licence.service.js";

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
