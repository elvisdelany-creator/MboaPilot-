import { describe, it, expect, vi } from "vitest";
import { creerDbTest } from "../../test-utils/db.js";
import { listerJournalUnifie, type JournalUnifieFiltre } from "./audit.repository.js";

// Test grandeur nature (300 000 entrées d'audit, 200 000 mouvements, 150 000 historiques) : la première page du journal prenait 346 ms et
// la même page filtrée par table 1,2 s, parce que chaque source était relue en entier puis triée par date pour n'en garder que 200.
// Chaque lecture doit se faire en parcourant un index dans l'ordre voulu : ni parcours complet de la table, ni tri temporaire.

function plansDesLectures(filtre: JournalUnifieFiltre): { sql: string; plan: string[] }[] {
  const db = creerDbTest();
  const prepare = vi.spyOn(db.$client, "prepare");
  listerJournalUnifie(db, filtre);
  const requetes = prepare.mock.calls.map(([sql]) => String(sql)).filter((sql) => /^select/i.test(sql));
  prepare.mockRestore();
  return requetes.map((sql) => {
    const parametres = Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => 1);
    const plan = (db.$client.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parametres) as { detail: string }[]).map((l) => l.detail);
    return { sql, plan };
  });
}

describe("lectures du journal d'audit à grand volume", () => {
  it.each<[string, JournalUnifieFiltre]>([
    ["périmètre « gestion » (par défaut)", {}],
    ["périmètre « ventes »", { perimetre: "ventes" }],
    ["périmètre « tout »", { perimetre: "tout" }],
    ["une table précise du journal central", { tableCible: "facture" }],
    ["une table précise (historique des abonnements)", { tableCible: "historique_abonnement" }],
  ])("%s : aucune source n'est relue en entier ni triée à part", (_nom, filtre) => {
    const lectures = plansDesLectures(filtre);
    expect(lectures.length).toBeGreaterThan(0);
    for (const { sql, plan } of lectures) {
      expect(plan.filter((l) => /TEMP B-TREE/i.test(l)), sql).toEqual([]);
      // une table jointe se cherche par clé ; la table lue se parcourt par un index
      expect(plan.filter((l) => /^SCAN \w+$/.test(l)), sql).toEqual([]);
    }
  });
});
