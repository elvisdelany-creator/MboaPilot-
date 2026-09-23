import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creerDbTest, type Db } from "../test-utils/db.js";
import { listerSauvegardes } from "../modules/sauvegarde/sauvegarde.service.js";
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
