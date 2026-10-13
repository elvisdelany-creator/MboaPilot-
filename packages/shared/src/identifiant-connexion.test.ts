import { describe, it, expect } from "vitest";
import { erreurIdentifiantConnexion, normaliserIdentifiant } from "./identifiant-connexion.js";

// La règle de l'identifiant de connexion était appliquée par l'API seule : l'administrateur ne la
// découvrait qu'après avoir validé le formulaire (« Élie Nga » refusé par un message en bas d'écran).
// Elle est partagée pour que le formulaire l'annonce et la vérifie en direct, avec le même texte.
describe("normaliserIdentifiant", () => {
  it("retire les espaces autour et passe en minuscules", () => {
    expect(normaliserIdentifiant("  VNga  ")).toBe("vnga");
  });
});

describe("erreurIdentifiantConnexion", () => {
  it.each(["vnga", "v.nga", "v_nga-2", "valentin@boutique.cm", "caissier01", "  VNga  ", "a".repeat(50)])("accepte « %s »", (identifiant) => {
    expect(erreurIdentifiantConnexion(identifiant)).toBeNull();
  });

  it.each([
    ["un accent", "Élie"],
    ["un espace au milieu", "elie nga"],
    ["une tabulation", "elie\tnga"],
    ["une lettre cyrillique", "аdmin"],
    ["un espace de largeur nulle", "admin​"],
    ["un point-virgule", "elie;nga"],
    ["moins de 3 caractères", "ab"],
    ["plus de 50 caractères", "a".repeat(51)],
  ])("refuse %s avec le message d'aide", (_libelle, identifiant) => {
    expect(erreurIdentifiantConnexion(identifiant)).toMatch(/3 à 50 caractères/);
  });

  it("ne dit rien d'un champ vide : l'obligation de le remplir est un autre message", () => {
    expect(erreurIdentifiantConnexion("")).toBeNull();
    expect(erreurIdentifiantConnexion("   ")).toBeNull();
  });
});
