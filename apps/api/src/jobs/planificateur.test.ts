import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerDbTest } from "../test-utils/db.js";
import { planifierJobQuotidien } from "./planificateur.js";

// 4.3, 4.4 : constaté à la lecture du démarrage — le job quotidien s'exécute dans le
// rappel de démarrage du serveur : une exception y arrêtait tout le serveur de caisse
// (process.exit), et dans le minuteur horaire elle le faisait planter. Le marqueur
// « déjà exécuté aujourd'hui » était en outre posé AVANT l'exécution : un job échoué
// n'était plus retenté avant le lendemain.
const RESULTAT = { abonnementsExpires: 0, alertesCreees: 0, notificationsTentees: 0, commissionsConfirmees: 0, commissionsAnnulees: 0, abonnesAnonymises: 0 };

let minuteur: NodeJS.Timeout | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (minuteur) clearInterval(minuteur);
  minuteur = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("planifierJobQuotidien : robustesse (4.3)", () => {
  it("un échec du job au démarrage n'arrête pas le serveur (pas d'exception) et est journalisé", () => {
    const executer = vi.fn(() => {
      throw new Error("disque en erreur");
    });

    expect(() => {
      minuteur = planifierJobQuotidien(creerDbTest(), 1000, executer);
    }).not.toThrow();

    expect(executer).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("retente à la vérification suivante après un échec, puis ne rejoue plus le même jour", () => {
    const executer = vi.fn().mockImplementationOnce(() => {
      throw new Error("panne passagère");
    }).mockReturnValue(RESULTAT);

    minuteur = planifierJobQuotidien(creerDbTest(), 1000, executer);
    expect(executer).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(executer).toHaveBeenCalledTimes(2); // retenté

    vi.advanceTimersByTime(5000);
    expect(executer).toHaveBeenCalledTimes(2); // réussi : plus rejoué ce jour-là
  });

  it("une exception dans le minuteur ne fait pas planter le processus", () => {
    const executer = vi.fn(() => {
      throw new Error("toujours en panne");
    });
    minuteur = planifierJobQuotidien(creerDbTest(), 1000, executer);

    expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
    expect(executer.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("rejoue le job au changement de date", () => {
    const executer = vi.fn().mockReturnValue(RESULTAT);
    minuteur = planifierJobQuotidien(creerDbTest(), 60 * 60 * 1000, executer);
    expect(executer).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(executer.mock.calls.map((a) => a[1])).toEqual(["2026-10-12", "2026-10-13"]);
  });
});

// Le jour de la boutique est celui de Douala (UTC+1) : à 00h30 à Douala (23h30 UTC), le job du nouveau jour doit tourner
// avec la date du nouveau jour, pas avec celle de la veille.
describe("planifierJobQuotidien : jour de Douala", () => {
  it("exécute le job du jour de Douala dès minuit à Douala, soit 23h UTC la veille", () => {
    vi.setSystemTime(new Date("2026-10-20T23:30:00Z"));
    const executer = vi.fn().mockReturnValue(RESULTAT);

    minuteur = planifierJobQuotidien(creerDbTest(), 1000, executer);

    // (on ne compare que la date : un échec afficherait sinon l'objet base entier)
    expect(executer.mock.calls[0]?.[1]).toBe("2026-10-21");
  });
});
