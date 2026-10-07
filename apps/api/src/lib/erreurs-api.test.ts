import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { envoyerErreur, messageClient } from "./erreurs-api.js";

// Constaté par fuzz de l'API : les erreurs 400 renvoyaient au client des messages
// internes — noms de colonnes et de tables (« NOT NULL constraint failed:
// facture.montant_total »), traces de code (« input.nom.trim is not a function »,
// « Cannot read properties of undefined »), « FOREIGN KEY constraint failed ».
// Illisibles pour un caissier, et ils révèlent la structure interne de la base.
function erreurSqlite(sql: string): Error {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE enfant (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id), code TEXT UNIQUE, CHECK (id > 0))");
  try {
    db.exec(sql);
  } catch (e) {
    return e as Error;
  }
  throw new Error("aucune erreur levée");
}

describe("messageClient", () => {
  it("garde tel quel un message métier (écrit pour l'utilisateur)", () => {
    expect(messageClient(new Error("Le montant encaissé doit être un nombre entier"))).toBe("Le montant encaissé doit être un nombre entier");
    expect(messageClient(new Error("Produit 12 introuvable"))).toBe("Produit 12 introuvable");
  });

  it("traduit une clé étrangère inexistante sans citer la base", () => {
    const message = messageClient(erreurSqlite("INSERT INTO enfant (parent_id) VALUES (999)"));
    expect(message).toMatch(/n'existe pas/i);
    expect(message).not.toMatch(/FOREIGN KEY|constraint/i);
  });

  it("traduit un champ obligatoire manquant sans citer table ni colonne", () => {
    const message = messageClient(erreurSqlite("INSERT INTO enfant (parent_id) VALUES (NULL)"));
    expect(message).toMatch(/obligatoires/i);
    expect(message).not.toMatch(/enfant|parent_id|NOT NULL/);
  });

  it("traduit un doublon (contrainte d'unicité)", () => {
    const message = messageClient(erreurSqlite("INSERT INTO parent (id) VALUES (1); INSERT INTO enfant (parent_id, code) VALUES (1, 'A'); INSERT INTO enfant (parent_id, code) VALUES (1, 'A')"));
    expect(message).toMatch(/existe déjà/i);
    expect(message).not.toMatch(/UNIQUE|enfant\.code/);
  });

  it.each([
    new TypeError("input.nom.trim is not a function"),
    new TypeError("Cannot read properties of undefined (reading 'find')"),
    new TypeError("Cannot read properties of null (reading 'trim')"),
    new RangeError("Too few parameter values were provided"),
    new TypeError("SQLite3 can only bind numbers, strings, bigints, buffers, and null"),
  ])("traduit l'erreur de programmation « %s » en requête mal formée", (erreur) => {
    const message = messageClient(erreur);
    expect(message).toMatch(/requête mal formée/i);
    expect(message).not.toMatch(/trim|undefined|null|function|parameter|bind/i);
  });

  it("ne plante pas sur une valeur qui n'est pas une erreur", () => {
    expect(messageClient("texte")).toBe("Erreur inconnue");
    expect(messageClient(undefined)).toBe("Erreur inconnue");
  });
});

describe("envoyerErreur", () => {
  function reponseEspion() {
    const reponse = { code: 0, corps: undefined as unknown, statut(c: number) { this.code = c; return this; }, envoyer(b: unknown) { this.corps = b; } };
    return {
      reponse,
      reply: { code: (c: number) => ({ send: (b: unknown) => { reponse.code = c; reponse.corps = b; } }) } as never,
    };
  }

  it("404 quand le message dit « introuvable », 400 sinon, avec un message lisible", () => {
    const a = reponseEspion();
    envoyerErreur(a.reply, new Error("Abonné 9 introuvable"));
    expect(a.reponse.code).toBe(404);
    expect(a.reponse.corps).toEqual({ erreur: "Abonné 9 introuvable" });

    const b = reponseEspion();
    envoyerErreur(b.reply, erreurSqlite("INSERT INTO enfant (parent_id) VALUES (999)"));
    expect(b.reponse.code).toBe(400);
    expect((b.reponse.corps as { erreur: string }).erreur).toMatch(/n'existe pas/i);

    const c = reponseEspion();
    envoyerErreur(c.reply, new TypeError("input.nom.trim is not a function"));
    expect(c.reponse.code).toBe(400);
    expect((c.reponse.corps as { erreur: string }).erreur).toMatch(/requête mal formée/i);
  });
});
