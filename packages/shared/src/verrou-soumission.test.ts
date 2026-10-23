import { describe, it, expect } from "vitest";
import { creerVerrouSoumission } from "./verrou-soumission.js";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 6.4, 9.2 : un double clic ou une touche Entrée répétée ne doit jamais encaisser deux fois la même vente
describe("creerVerrouSoumission", () => {
  it("trois déclenchements dans la même tâche : l'action ne s'exécute qu'une fois", async () => {
    const executer = creerVerrouSoumission();
    let appels = 0;
    const action = async () => { appels += 1; await pause(10); return "fait"; };

    const resultats = await Promise.all([executer(action), executer(action), executer(action)]);

    expect(appels).toBe(1);
    expect(resultats).toEqual(["fait", undefined, undefined]);
  });

  it("un déclenchement qui arrive pendant l'exécution est ignoré, pas mis en file d'attente", async () => {
    const executer = creerVerrouSoumission();
    let appels = 0;
    const premiere = executer(async () => { appels += 1; await pause(30); });
    await pause(5);
    await executer(async () => { appels += 1; });
    await premiere;

    expect(appels).toBe(1);
  });

  it("une fois l'action terminée, un nouveau déclenchement s'exécute (nouvelle vente)", async () => {
    const executer = creerVerrouSoumission();
    let appels = 0;

    await executer(async () => { appels += 1; });
    await executer(async () => { appels += 1; });

    expect(appels).toBe(2);
  });

  it("une action qui échoue libère le verrou : le caissier peut réessayer", async () => {
    const executer = creerVerrouSoumission();

    await expect(executer(async () => { throw new Error("Le prix a changé"); })).rejects.toThrow("Le prix a changé");
    const resultat = await executer(async () => "réessai");

    expect(resultat).toBe("réessai");
  });

  it("deux verrous sont indépendants (deux fenêtres, deux ventes)", async () => {
    const a = creerVerrouSoumission();
    const b = creerVerrouSoumission();
    let appels = 0;

    await Promise.all([a(async () => { appels += 1; await pause(5); }), b(async () => { appels += 1; await pause(5); })]);

    expect(appels).toBe(2);
  });
});
