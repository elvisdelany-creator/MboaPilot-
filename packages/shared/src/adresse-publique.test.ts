import { describe, expect, it } from "vitest";
import { construireUrlVerification, erreurAdressePublique, normaliserAdressePublique } from "./adresse-publique.js";

// Le QR du ticket doit mener, depuis le téléphone d'un client, à la fiche de vérification de la facture. Une adresse
// « localhost » ou « 127.0.0.1 » n'existe que sur le poste de caisse : le client scannait un lien mort.
describe("erreurAdressePublique", () => {
  it.each(["https://verif.maboutique.cm", "http://verif.maboutique.cm", "https://maboutique.cm:8443", "https://203.0.113.10", "https://verif.maboutique.cm/", "  https://verif.maboutique.cm  "])(
    "accepte %s",
    (adresse) => {
      expect(erreurAdressePublique(adresse)).toBeNull();
    }
  );

  it("accepte une saisie vide (pas d'adresse : le QR n'est pas imprimé)", () => {
    expect(erreurAdressePublique("")).toBeNull();
    expect(erreurAdressePublique("   ")).toBeNull();
  });

  it.each([
    ["http://localhost:3001", /poste/i],
    ["http://127.0.0.1:3001", /poste/i],
    ["http://127.1.2.3", /poste/i],
    ["http://[::1]:3001", /poste/i],
    ["http://0.0.0.0", /poste/i],
    ["https://LOCALHOST", /poste/i],
    ["verif.maboutique.cm", /http/i],
    ["ftp://verif.maboutique.cm", /http/i],
    ["javascript:alert(1)", /http/i],
    ["https://", /adresse/i],
    ["https://utilisateur:mdp@verif.maboutique.cm", /identifiant|mot de passe/i],
    ["https://verif.maboutique.cm/boutique", /chemin|racine/i],
    ["https://verif.maboutique.cm/?a=1", /chemin|paramètre|racine/i],
    ["https://verif.maboutique.cm/#haut", /chemin|paramètre|racine/i],
    ["https://verif maboutique.cm", /adresse/i],
    [`https://${"a".repeat(250)}.cm`, /caractères/i],
  ])("refuse %s", (adresse, message) => {
    expect(erreurAdressePublique(adresse)).toMatch(message);
  });
});

describe("normaliserAdressePublique", () => {
  it("renvoie l'origine, sans espaces ni barre finale, en minuscules pour le domaine", () => {
    expect(normaliserAdressePublique("  https://Verif.MaBoutique.cm/ ")).toBe("https://verif.maboutique.cm");
    expect(normaliserAdressePublique("https://maboutique.cm:8443")).toBe("https://maboutique.cm:8443");
  });

  it("renvoie null pour une saisie vide", () => {
    expect(normaliserAdressePublique("")).toBeNull();
    expect(normaliserAdressePublique("   ")).toBeNull();
  });
});

describe("construireUrlVerification", () => {
  it("assemble l'adresse publique, le numéro de facture et le jeton", () => {
    expect(construireUrlVerification("https://verif.maboutique.cm", 12, "abc123")).toBe("https://verif.maboutique.cm/verification/12/abc123");
  });
});
