import { describe, it, expect } from "vitest";
import { lireDateServeur } from "./date-serveur.js";

// Constaté en test grandeur nature : SQLite écrit les horodatages en UTC sans fuseau
// (« 2026-10-12 15:18:12 ») ; le navigateur lit « new Date("2026-10-12 15:18:12") » comme une
// heure LOCALE. Au Cameroun (UTC+1), un dossier ouvert à 16 h 18 s'affichait « 15:18 », reçus
// imprimés compris. Ces tests ne dépendent pas du fuseau de la machine qui les exécute.
describe("lireDateServeur", () => {
  it("lit un horodatage SQLite sans fuseau comme de l'UTC", () => {
    expect(lireDateServeur("2026-10-12 15:18:12").getTime()).toBe(Date.UTC(2026, 9, 12, 15, 18, 12));
  });

  it("lit de la même façon un horodatage ISO sans fuseau (séparateur T) et sans secondes", () => {
    expect(lireDateServeur("2026-10-12T15:18:12").getTime()).toBe(Date.UTC(2026, 9, 12, 15, 18, 12));
    expect(lireDateServeur("2026-10-12 15:18").getTime()).toBe(Date.UTC(2026, 9, 12, 15, 18, 0));
  });

  it("garde les fractions de seconde", () => {
    expect(lireDateServeur("2026-10-12 15:18:12.250").getTime()).toBe(Date.UTC(2026, 9, 12, 15, 18, 12, 250));
  });

  it("respecte un fuseau explicite (Z ou décalage)", () => {
    expect(lireDateServeur("2026-10-12T15:18:12.000Z").getTime()).toBe(Date.UTC(2026, 9, 12, 15, 18, 12));
    expect(lireDateServeur("2026-10-12T16:18:12+01:00").getTime()).toBe(Date.UTC(2026, 9, 12, 15, 18, 12));
  });

  it("lit une date seule (sans heure) comme un jour du calendrier local, jamais décalée d'un jour", () => {
    const date = lireDateServeur("2026-10-12");

    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 12]);
    expect([date.getHours(), date.getMinutes()]).toEqual([0, 0]);
  });

  it("renvoie une date invalide (et non une exception) pour un texte illisible", () => {
    expect(Number.isNaN(lireDateServeur("n'importe quoi").getTime())).toBe(true);
  });
});
