import { describe, it, expect } from "vitest";
import { cleVerrouConnexion, creerVerrouConnexion } from "./verrou-connexion.js";

// Verrou de connexion par compte ET adresse (mode hébergé). Le verrou par compte seul laisse n'importe qui, depuis Internet, bloquer
// l'administrateur en boucle avec cinq mots de passe faux : ici, seule l'adresse qui se trompe est bloquée pour ce compte.
function verrou(options = {}) {
  let maintenant = 1_000_000;
  const v = creerVerrouConnexion({ horloge: () => maintenant, ...options });
  return { v, avancer: (ms: number) => (maintenant += ms) };
}

const MINUTE = 60_000;

describe("verrou par compte et adresse", () => {
  it("bloque au 5e échec, pour 15 minutes, et dit combien de temps attendre", () => {
    const { v } = verrou();
    for (let i = 0; i < 4; i++) {
      v.enregistrerEchec("admin|1.2.3.4");
      expect(v.verifier("admin|1.2.3.4").verrouille).toBe(false);
    }
    v.enregistrerEchec("admin|1.2.3.4");

    const verdict = v.verifier("admin|1.2.3.4");
    expect(verdict.verrouille).toBe(true);
    expect(verdict.reessayerDansSecondes).toBe(15 * 60);
  });

  it("ne bloque que l'adresse qui se trompe : le même compte reste ouvert depuis une autre adresse, et un autre compte depuis la même", () => {
    const { v } = verrou();
    for (let i = 0; i < 5; i++) v.enregistrerEchec("admin|1.2.3.4");

    expect(v.verifier("admin|1.2.3.4").verrouille).toBe(true);
    expect(v.verifier("admin|5.6.7.8").verrouille).toBe(false); // l'administrateur, depuis la boutique
    expect(v.verifier("caissier|1.2.3.4").verrouille).toBe(false);
  });

  it("se déverrouille tout seul au bout de 15 minutes, avec des compteurs neufs", () => {
    const { v, avancer } = verrou();
    for (let i = 0; i < 5; i++) v.enregistrerEchec("admin|1.2.3.4");

    avancer(14 * MINUTE);
    expect(v.verifier("admin|1.2.3.4").verrouille).toBe(true);
    avancer(2 * MINUTE);
    expect(v.verifier("admin|1.2.3.4").verrouille).toBe(false);
    for (let i = 0; i < 4; i++) v.enregistrerEchec("admin|1.2.3.4");
    expect(v.verifier("admin|1.2.3.4").verrouille).toBe(false); // 4 échecs seulement : le compteur est reparti de zéro
  });

  it("une connexion réussie remet le compteur à zéro", () => {
    const { v } = verrou();
    for (let i = 0; i < 4; i++) v.enregistrerEchec("admin|1.2.3.4");
    v.reinitialiser("admin|1.2.3.4");
    for (let i = 0; i < 4; i++) v.enregistrerEchec("admin|1.2.3.4");

    expect(v.verifier("admin|1.2.3.4").verrouille).toBe(false);
  });

  it("des échecs espacés de plus de 15 minutes ne s'additionnent pas", () => {
    const { v, avancer } = verrou();
    for (let i = 0; i < 4; i++) v.enregistrerEchec("admin|1.2.3.4");
    avancer(16 * MINUTE);
    v.enregistrerEchec("admin|1.2.3.4");

    expect(v.verifier("admin|1.2.3.4").verrouille).toBe(false);
  });

  it("un échec pendant le verrouillage ne le prolonge pas : l'adresse n'est pas bloquée à vie par un script qui insiste", () => {
    const { v, avancer } = verrou();
    for (let i = 0; i < 5; i++) v.enregistrerEchec("admin|1.2.3.4");
    avancer(10 * MINUTE);
    for (let i = 0; i < 20; i++) v.enregistrerEchec("admin|1.2.3.4");

    avancer(6 * MINUTE);
    expect(v.verifier("admin|1.2.3.4").verrouille).toBe(false);
  });

  it("la table ne grossit pas sans fin sous un balayage d'adresses", () => {
    const { v, avancer } = verrou();
    for (let i = 0; i < 12_000; i++) v.enregistrerEchec(`admin|10.0.${Math.floor(i / 250)}.${i % 250}`);
    avancer(20 * MINUTE);
    v.enregistrerEchec("admin|9.9.9.9"); // déclenche la purge des entrées périmées

    expect(v.taille()).toBeLessThan(1000);
  });
});

describe("cleVerrouConnexion", () => {
  it("ne distingue pas les majuscules ni les espaces autour de l'identifiant : « Admin » et « admin » sont le même compte", () => {
    expect(cleVerrouConnexion(" Admin ", "1.2.3.4")).toBe(cleVerrouConnexion("admin", "1.2.3.4"));
  });

  it("une valeur qui n'est pas du texte ne plante pas et ne partage pas la clé d'un vrai compte", () => {
    expect(cleVerrouConnexion({ x: 1 } as unknown as string, "1.2.3.4")).not.toBe(cleVerrouConnexion("admin", "1.2.3.4"));
    expect(() => cleVerrouConnexion(undefined as unknown as string, "1.2.3.4")).not.toThrow();
  });
});
