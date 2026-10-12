import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creerDbTest, type Db } from "../test-utils/db.js";
import { creerSauvegarde, listerSauvegardes } from "../modules/sauvegarde/sauvegarde.service.js";
import { planifierSauvegardeQuotidienne } from "./planificateur-sauvegarde.js";

let db: Db;
let dossierSauvegardes: string;
let minuteur: NodeJS.Timeout | null = null;

afterEach(() => {
  if (minuteur) clearInterval(minuteur);
  rmSync(dossierSauvegardes, { recursive: true, force: true });
});

// 2.6 : la sauvegarde automatique quotidienne se déclenche immédiatement au
// démarrage du serveur — un redémarrage (mise à jour, coupure de courant sur
// le poste de la boutique, plantage relancé par un gestionnaire de process)
// ne doit jamais recréer une sauvegarde déjà faite le jour même : le repère
// "déjà fait aujourd'hui" doit survivre au redémarrage, pas rester en mémoire.
describe("planifierSauvegardeQuotidienne (2.6)", () => {
  it("ne recrée pas de sauvegarde du jour après un redémarrage du serveur", () => {
    db = creerDbTest();
    dossierSauvegardes = mkdtempSync(join(tmpdir(), "mboapilot-test-planificateur-"));

    minuteur = planifierSauvegardeQuotidienne(db, dossierSauvegardes);
    expect(listerSauvegardes(dossierSauvegardes)).toHaveLength(1);
    clearInterval(minuteur);

    // simule un redémarrage : nouvel appel, donc nouvel état en mémoire
    minuteur = planifierSauvegardeQuotidienne(db, dossierSauvegardes);

    expect(listerSauvegardes(dossierSauvegardes)).toHaveLength(1);
  });
});

// 2.6 : même risque que le job quotidien — un disque plein ou un dossier de sauvegarde
// inaccessible (clé USB retirée) faisait échouer la sauvegarde dans le rappel de démarrage,
// donc arrêter tout le serveur de caisse ; et dans le minuteur horaire, le faire planter.
describe("planifierSauvegardeQuotidienne : robustesse (2.6)", () => {
  it("un échec de sauvegarde n'arrête pas le serveur, est journalisé et retenté ensuite", () => {
    db = creerDbTest();
    dossierSauvegardes = mkdtempSync(join(tmpdir(), "mboapilot-test-planificateur-"));
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const creer = vi.fn().mockImplementationOnce(() => {
        throw new Error("disque plein");
      }).mockImplementation((base, dossier) => creerSauvegarde(base, dossier));

      expect(() => {
        minuteur = planifierSauvegardeQuotidienne(db, dossierSauvegardes, 30, 1000, creer);
      }).not.toThrow();
      expect(erreurs).toHaveBeenCalled();
      expect(listerSauvegardes(dossierSauvegardes)).toHaveLength(0);

      vi.advanceTimersByTime(1000); // retenté à la vérification suivante, et cette fois réussi
      expect(listerSauvegardes(dossierSauvegardes)).toHaveLength(1);
      expect(creer).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
