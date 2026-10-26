import { describe, it, expect } from "vitest";
import { messageSavPret } from "./message-sav-pret.js";

// 8.4 : « Notification au client lorsque l'appareil passe au statut Prêt ». Le SMS doit dire qui écrit, pour quel dossier, et ce
// qu'il faut prévoir : un client qui a laissé un appareil ailleurs ne sait pas de quoi il s'agit.
describe("messageSavPret", () => {
  it("avec la boutique, le numéro de dossier et le montant à régler", () => {
    expect(messageSavPret({ entreprise: "Boutique Akwa", numeroDossier: 12, montantDu: 5000 })).toBe(
      "Boutique Akwa : votre appareil (dossier n°12) est prêt à être récupéré. Montant à régler : 5 000 FCFA."
    );
  });

  it("les milliers sont séparés par une espace ordinaire : une passerelle SMS ne transmet pas toujours l'espace insécable", () => {
    const m = messageSavPret({ entreprise: "B", numeroDossier: 1, montantDu: 1250000 });
    expect(m).toContain("1 250 000 FCFA");
    expect(m).not.toContain(" "); // espace fine insécable (celle de Intl fr-FR)
    expect(m).not.toContain(" "); // espace insécable
  });

  it("sous garantie ou sans frais : aucun montant à régler", () => {
    const m = messageSavPret({ entreprise: "Boutique Akwa", numeroDossier: 12, montantDu: 0 });
    expect(m).toContain("est prêt à être récupéré. Aucun frais à régler.");
    expect(m).not.toContain("FCFA");
  });

  it("sans nom de boutique, le message commence par « Votre appareil »", () => {
    expect(messageSavPret({ entreprise: "  ", numeroDossier: 3, montantDu: 2000 }).startsWith("Votre appareil (dossier n°3) est prêt")).toBe(true);
  });

  it("reste court : un SMS habituel tient en deux segments", () => {
    expect(messageSavPret({ entreprise: "Boutique Bonamoussadi", numeroDossier: 1234, montantDu: 125000 }).length).toBeLessThanOrEqual(160);
  });
});
