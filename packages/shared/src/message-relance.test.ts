import { describe, it, expect } from "vitest";
import { messageRelanceEcheance } from "./message-relance.js";

const base = { entreprise: "Boutique Akwa", libelleAbonnement: "CANAL+ EVASION", numeroAbonnement: 12, dateFin: "30/10/2026" };

// 4.4 : J-7 courtoisie, J-3 relance ferme, J-1 dernier rappel — le client sait qui lui écrit, pour quel abonnement et quand
describe("messageRelanceEcheance", () => {
  it("J-7 : ton de courtoisie, avec la boutique, l'abonnement, l'échéance en clair et la date", () => {
    const m = messageRelanceEcheance({ ...base, joursRestants: 7, rang: 3 });
    expect(m).toBe("Boutique Akwa : votre abonnement CANAL+ EVASION n°12 arrive à échéance dans 7 jours (30/10/2026). Pensez à vous réabonner.");
  });

  it("J-3 : relance ferme", () => {
    const m = messageRelanceEcheance({ ...base, joursRestants: 3, rang: 2 });
    expect(m).toContain("Boutique Akwa : rappel — votre abonnement CANAL+ EVASION n°12 arrive à échéance dans 3 jours (30/10/2026).");
    expect(m).toContain("Réabonnez-vous dès maintenant");
  });

  it("J-1 : dernier rappel, « demain »", () => {
    const m = messageRelanceEcheance({ ...base, joursRestants: 1, rang: 1 });
    expect(m).toContain("dernier rappel");
    expect(m).toContain("arrive à échéance demain (30/10/2026)");
  });

  it("le jour même : « aujourd'hui », jamais « dans 0 jours »", () => {
    const m = messageRelanceEcheance({ ...base, joursRestants: 0, rang: 1 });
    expect(m).toContain("arrive à échéance aujourd'hui (30/10/2026)");
    expect(m).not.toContain("dans 0");
    expect(m.match(/aujourd'hui/g)).toHaveLength(1); // pas de répétition avec la consigne
  });

  it("le ton suit le jalon, pas le nombre de jours exact (poste éteint le jour du seuil : rattrapage)", () => {
    expect(messageRelanceEcheance({ ...base, joursRestants: 2, rang: 2 })).toContain("dans 2 jours");
    expect(messageRelanceEcheance({ ...base, joursRestants: 2, rang: 2 })).toContain("rappel — ");
    expect(messageRelanceEcheance({ ...base, joursRestants: 5, rang: 3 })).toContain("Pensez à vous réabonner");
  });

  it("sans nom de boutique, le message commence directement par « Votre abonnement »", () => {
    const m = messageRelanceEcheance({ ...base, entreprise: "  ", joursRestants: 7, rang: 3 });
    expect(m.startsWith("Votre abonnement CANAL+ EVASION n°12")).toBe(true);
  });

  it("reste court : un SMS de relance habituel tient en deux segments", () => {
    for (const [jours, rang] of [[7, 3], [3, 2], [1, 1], [0, 1]] as const) {
      expect(messageRelanceEcheance({ ...base, joursRestants: jours, rang }).length).toBeLessThanOrEqual(160);
    }
  });
});
