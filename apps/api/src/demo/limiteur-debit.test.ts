import { describe, it, expect } from "vitest";
import { creerLimiteurDebit } from "./limiteur-debit.js";

// une démo publique n'a pas de visiteur « de confiance » : sans plafond par adresse, un script peut saturer le serveur gratuit
describe("creerLimiteurDebit", () => {
  it("autorise jusqu'au plafond dans la fenêtre, puis refuse avec le délai avant de pouvoir réessayer", () => {
    let maintenant = 1_000_000;
    const limiteur = creerLimiteurDebit({ fenetreMs: 60_000, maximum: 3 }, () => maintenant);

    expect(limiteur.verifier("1.2.3.4").autorise).toBe(true);
    expect(limiteur.verifier("1.2.3.4").autorise).toBe(true);
    expect(limiteur.verifier("1.2.3.4").autorise).toBe(true);
    maintenant += 10_000;
    const refus = limiteur.verifier("1.2.3.4");
    expect(refus.autorise).toBe(false);
    expect(refus.reessayerDansSecondes).toBe(50); // il reste 50 s de la fenêtre de 60 s
  });

  it("repart de zéro à la fenêtre suivante", () => {
    let maintenant = 0;
    const limiteur = creerLimiteurDebit({ fenetreMs: 60_000, maximum: 1 }, () => maintenant);
    expect(limiteur.verifier("a").autorise).toBe(true);
    expect(limiteur.verifier("a").autorise).toBe(false);

    maintenant = 60_000;
    expect(limiteur.verifier("a").autorise).toBe(true);
  });

  it("compte chaque adresse séparément", () => {
    const limiteur = creerLimiteurDebit({ fenetreMs: 60_000, maximum: 1 }, () => 0);
    expect(limiteur.verifier("a").autorise).toBe(true);
    expect(limiteur.verifier("b").autorise).toBe(true);
    expect(limiteur.verifier("a").autorise).toBe(false);
  });

  it("oublie les adresses dont la fenêtre est passée : la mémoire ne grossit pas indéfiniment", () => {
    let maintenant = 0;
    const limiteur = creerLimiteurDebit({ fenetreMs: 1_000, maximum: 5 }, () => maintenant);
    for (let i = 0; i < 50; i++) limiteur.verifier(`ip-${i}`);
    expect(limiteur.taille()).toBe(50);

    maintenant = 10_000;
    limiteur.nettoyer();
    expect(limiteur.taille()).toBe(0);
  });
});
