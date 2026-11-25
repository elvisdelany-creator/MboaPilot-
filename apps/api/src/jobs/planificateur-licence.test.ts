import { describe, it, expect, afterEach, vi } from "vitest";
import { creerDbTest } from "../test-utils/db.js";
import * as schema from "../db/schema.js";
import { calculerEtatLicence, obtenirOuCreerLicence } from "../modules/licence/licence.service.js";
import { planifierRevalidationLicence } from "./planificateur-licence.js";

// Test grandeur nature « licence », défaut 1 : la licence n'était revalidée qu'au démarrage. Un poste laissé allumé ou en veille passait en
// lecture seule au 22e jour, avec un abonnement parfaitement à jour.
let minuteur: NodeJS.Timeout | null = null;

afterEach(() => {
  if (minuteur) clearInterval(minuteur);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const DEPART = Date.parse("2026-11-25T08:00:00.000Z");
const JOUR = 86_400_000;

describe("planifierRevalidationLicence (10.4 : au démarrage puis chaque jour)", () => {
  it("un serveur laissé allumé 60 jours reste actif", () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEPART);
    const db = creerDbTest();
    minuteur = planifierRevalidationLicence(db);

    for (let n = 1; n <= 60; n++) {
      vi.setSystemTime(DEPART + n * JOUR);
      vi.advanceTimersByTime(60_000);
      const maintenant = new Date().toISOString();
      expect(calculerEtatLicence(obtenirOuCreerLicence(db, maintenant), maintenant).etat, `jour ${n}`).toBe("ACTIVE");
    }
  });

  it("au réveil d'un ordinateur resté 40 jours en veille, la licence est revalidée dans la minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEPART);
    const db = creerDbTest();
    minuteur = planifierRevalidationLicence(db);

    vi.setSystemTime(DEPART + 40 * JOUR);
    vi.advanceTimersByTime(60_000);

    expect(db.select().from(schema.licence).get()!.derniereRevalidationReussie.slice(0, 10)).toBe("2027-01-04");
  });

  it("revalide au démarrage, puis n'écrit qu'une fois par jour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEPART);
    const db = creerDbTest();
    obtenirOuCreerLicence(db, "2026-11-01T08:00:00.000Z");
    minuteur = planifierRevalidationLicence(db);
    const auDemarrage = db.select().from(schema.licence).get()!.derniereRevalidationReussie;
    expect(auDemarrage).toBe("2026-11-25T08:00:00.000Z");

    vi.advanceTimersByTime(3 * 3600_000);

    expect(db.select().from(schema.licence).get()!.derniereRevalidationReussie).toBe(auDemarrage);
  });

  it("un échec n'arrête pas le serveur : il est journalisé et retenté", () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEPART);
    const db = creerDbTest();
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const revalider = vi.fn().mockImplementationOnce(() => {
      throw new Error("base occupée");
    });

    expect(() => {
      minuteur = planifierRevalidationLicence(db, 60_000, revalider);
    }).not.toThrow();
    expect(journal).toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(revalider).toHaveBeenCalledTimes(2);
  });
});
