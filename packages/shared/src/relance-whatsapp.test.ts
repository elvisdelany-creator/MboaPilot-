import { describe, it, expect } from "vitest";
import { lienWhatsApp, lienWhatsAppAbonnementExpire, lienWhatsAppRelanceEcheance, messageAbonnementExpire, numeroWhatsApp, relanceAbonnement } from "./relance-whatsapp.js";
import { messageRelanceEcheance } from "./message-relance.js";

// wa.me veut le numéro au format international, chiffres seulement, sans « + » ni « 00 » : « 237677000000 »
describe("numeroWhatsApp", () => {
  it.each([
    ["677 00 00 00", "237677000000"], // numéro camerounais saisi à la locale (9 chiffres)
    ["677000000", "237677000000"],
    ["+237 677 00 00 00", "237677000000"],
    ["00237677000000", "237677000000"],
    ["237677000000", "237677000000"],
    ["(237) 677.00.00.00", "237677000000"],
    ["600000005", "237600000005"], // les numéros fictifs de la démo
    ["+33 6 12 34 56 78", "33612345678"], // un numéro étranger saisi avec son indicatif reste tel quel
    ["0033612345678", "33612345678"],
  ])("%s -> %s", (saisie, attendu) => {
    expect(numeroWhatsApp(saisie)).toBe(attendu);
  });

  it.each(["", "   ", "abc", "12345", "677 00 00", "06 12 34 56 78", "1234567890123456"])("refuse %j : on ne devine pas le pays, mieux vaut ne pas envoyer à un inconnu", (saisie) => {
    expect(numeroWhatsApp(saisie)).toBeNull();
  });
});

describe("lienWhatsApp", () => {
  it("ouvre une conversation avec le message déjà écrit, encodé pour une adresse web", () => {
    const lien = lienWhatsApp("677 00 00 00", "Boutique Akwa : rappel — n°12 (30/10/2026). Contact & réponse ?");

    expect(lien).toBe(`https://wa.me/237677000000?text=${encodeURIComponent("Boutique Akwa : rappel — n°12 (30/10/2026). Contact & réponse ?")}`);
    expect(new URL(lien!).searchParams.get("text")).toBe("Boutique Akwa : rappel — n°12 (30/10/2026). Contact & réponse ?");
  });

  it("renvoie null quand le numéro n'est pas utilisable", () => {
    expect(lienWhatsApp("abc", "Bonjour")).toBeNull();
  });
});

describe("messageAbonnementExpire", () => {
  const base = { entreprise: "Boutique Akwa", libelleAbonnement: "CANAL+ EVASION", numeroAbonnement: 12, dateFin: "30/10/2026" };

  it("dit qui écrit, quel abonnement, la date d'expiration, et invite à se réabonner", () => {
    expect(messageAbonnementExpire(base)).toBe("Boutique Akwa : votre abonnement CANAL+ EVASION n°12 a expiré le 30/10/2026. Réabonnez-vous pour retrouver vos chaînes.");
  });

  it("sans nom de boutique, commence par une majuscule", () => {
    expect(messageAbonnementExpire({ ...base, entreprise: "  " }).startsWith("Votre abonnement CANAL+ EVASION")).toBe(true);
  });
});

describe("liens de relance prêts à ouvrir", () => {
  it("échéance : le même texte que le SMS de relance (sans la ligne de contact, inutile sur WhatsApp), vers le client", () => {
    const donnees = { entreprise: "Boutique Akwa", libelleAbonnement: "CANAL+ EVASION", numeroAbonnement: 12, dateFin: "30/10/2026", joursRestants: 3, rang: 2 as const };

    const lien = lienWhatsAppRelanceEcheance({ ...donnees, telephone: "677 00 00 00" });

    expect(lien).toContain("https://wa.me/237677000000?text=");
    expect(new URL(lien!).searchParams.get("text")).toBe(messageRelanceEcheance(donnees));
  });

  it("abonnement expiré : message de reconquête vers le client", () => {
    const lien = lienWhatsAppAbonnementExpire({ entreprise: "Boutique Akwa", libelleAbonnement: "CANAL+ EVASION", numeroAbonnement: 12, dateFin: "30/10/2026", telephone: "+237 699 11 22 33" });

    expect(lien).toContain("https://wa.me/237699112233?text=");
    expect(new URL(lien!).searchParams.get("text")).toContain("a expiré le 30/10/2026");
  });

  it("null quand le numéro du client n'est pas utilisable (le bouton est alors grisé)", () => {
    expect(lienWhatsAppRelanceEcheance({ entreprise: "B", libelleAbonnement: "X", numeroAbonnement: 1, dateFin: "01/01/2026", joursRestants: 1, rang: 1, telephone: "n/a" })).toBeNull();
  });
});

// Depuis la fiche du client : le gérant relance un abonnement précis, sans passer par la liste du tableau de bord. Le texte et le type de relance
// dépendent de l'état réel de l'abonnement ce jour-là, pas seulement de son statut enregistré (le traitement de nuit peut ne pas être passé).
describe("relanceAbonnement", () => {
  const base = { entreprise: "Next Services", libelleAbonnement: "CANAL+ EVASION", numeroAbonnement: 6, aujourdHui: "2026-11-16" };

  it("un abonnement actif qui arrive à échéance : relance d'échéance, avec le délai dit en clair", () => {
    const relance = relanceAbonnement({ ...base, statut: "ACTIF", dateFin: "2026-11-19" });
    expect(relance?.evenement).toBe("ALERTE_ECHEANCE");
    expect(relance?.message).toBe(
      messageRelanceEcheance({ entreprise: "Next Services", libelleAbonnement: "CANAL+ EVASION", numeroAbonnement: 6, dateFin: "19/11/2026", joursRestants: 3, rang: 2 }),
    );
    expect(relance?.message).toContain("dans 3 jours");
  });

  it.each([
    [0, 1], // aujourd'hui : dernier rappel
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [30, 3], // loin de l'échéance : ton de courtoisie
  ])("à %i jour(s) de l'échéance, le ton est celui du palier %i", (jours, rang) => {
    const dateFin = new Date(Date.parse("2026-11-16T00:00:00Z") + jours * 86_400_000).toISOString().slice(0, 10);
    const relance = relanceAbonnement({ ...base, statut: "ACTIF", dateFin });
    expect(relance?.message).toBe(
      messageRelanceEcheance({
        entreprise: "Next Services",
        libelleAbonnement: "CANAL+ EVASION",
        numeroAbonnement: 6,
        dateFin: dateFin.split("-").reverse().join("/"),
        joursRestants: jours,
        rang: rang as 1 | 2 | 3,
      }),
    );
  });

  it("un abonnement expiré : relance de reconquête, avec la date d'expiration", () => {
    const relance = relanceAbonnement({ ...base, statut: "EXPIRE", dateFin: "2026-11-10" });
    expect(relance).toEqual({
      evenement: "ABONNEMENT_EXPIRE",
      message: messageAbonnementExpire({ entreprise: "Next Services", libelleAbonnement: "CANAL+ EVASION", numeroAbonnement: 6, dateFin: "10/11/2026" }),
    });
  });

  it("un abonnement encore « actif » mais dont la date est dépassée est relancé comme expiré, jamais comme « arrive à échéance hier »", () => {
    const relance = relanceAbonnement({ ...base, statut: "ACTIF", dateFin: "2026-11-15" });
    expect(relance?.evenement).toBe("ABONNEMENT_EXPIRE");
    expect(relance?.message).toContain("a expiré le 15/11/2026");
  });

  it("un abonnement résilié ne se relance pas : le client l'a arrêté", () => {
    expect(relanceAbonnement({ ...base, statut: "RESILIE", dateFin: "2026-12-31" })).toBeNull();
  });
});
