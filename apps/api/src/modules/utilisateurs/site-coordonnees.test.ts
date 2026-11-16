import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "./utilisateur.repository.js";
import { modifierSite } from "./site.repository.js";
import * as schema from "../../db/schema.js";

const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";

let db: Db;
let siteId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A", adresse: "Rue du Marché" }).returning().get().idSite;
  creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Paul", identifiant: "caissier1", motDePasse: "motdepasse-secret", role: "CAISSIER" });
  creerUtilisateur(db, { siteId, nom: "Ndi", prenom: "Marie", identifiant: "gerant1", motDePasse: "motdepasse-secret", role: "GERANT" });
});

const lireSite = () => db.select().from(schema.site).where(eq(schema.site.idSite, siteId)).get()!;

async function entetes(app: FastifyInstance, identifiant: string) {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse: "motdepasse-secret" } });
  return { authorization: `Bearer ${reponse.json().token as string}` };
}

describe("modifierSite : coordonnées de la boutique", () => {
  it("enregistre l'adresse, les deux téléphones, l'e-mail et le site web (espaces autour retirés)", () => {
    modifierSite(db, siteId, {
      adresse: "  Boulevard de la Liberté, Akwa ",
      telephone: " 677 00 00 00 ",
      telephoneWhatsapp: "+237 699 11 22 33",
      email: " contact@boutique.cm ",
      siteWeb: " www.boutique.cm ",
    });

    expect(lireSite()).toMatchObject({
      adresse: "Boulevard de la Liberté, Akwa",
      telephone: "677 00 00 00",
      telephoneWhatsapp: "+237 699 11 22 33",
      email: "contact@boutique.cm",
      siteWeb: "www.boutique.cm",
    });
  });

  it("une valeur vide efface le champ (retour à « non renseigné »)", () => {
    modifierSite(db, siteId, { telephone: "677 00 00 00", email: "contact@boutique.cm" });

    modifierSite(db, siteId, { telephone: "", email: "   " });

    expect(lireSite().telephone).toBeNull();
    expect(lireSite().email).toBeNull();
  });

  it("ne touche pas aux champs absents de la demande", () => {
    modifierSite(db, siteId, { telephone: "677 00 00 00", siteWeb: "www.boutique.cm" });

    modifierSite(db, siteId, { email: "contact@boutique.cm" });

    expect(lireSite()).toMatchObject({ telephone: "677 00 00 00", siteWeb: "www.boutique.cm", email: "contact@boutique.cm", adresse: "Rue du Marché" });
  });

  it.each([
    [{ telephone: "abc" }, /téléphone/i],
    [{ telephone: "123" }, /téléphone/i],
    [{ telephoneWhatsapp: "pas un numéro" }, /whatsapp/i],
    [{ email: "sans-arobase" }, /e-mail/i],
    [{ siteWeb: "javascript:alert(1)" }, /site web/i],
    [{ siteWeb: "mon site.cm" }, /site web/i],
  ])("refuse %j sans rien enregistrer", (saisie, message) => {
    expect(() => modifierSite(db, siteId, { telephone: "677 00 00 00", ...saisie })).toThrow(message);

    expect(lireSite().telephone).toBeNull(); // rien n'a été appliqué, pas même le champ valide de la même demande
  });
});

describe("PATCH /api/v1/site/coordonnees", () => {
  it("un gérant enregistre les coordonnées de sa boutique, et elles reviennent dans les informations de l'entreprise", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const headers = await entetes(app, "gerant1");

    const reponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/site/coordonnees",
      headers,
      payload: { adresse: "Akwa", telephone: "677 00 00 00", telephoneWhatsapp: "699 11 22 33", email: "contact@boutique.cm", siteWeb: "www.boutique.cm" },
    });

    expect(reponse.statusCode).toBe(200);
    const infos = (await app.inject({ method: "GET", url: "/api/v1/entreprise", headers })).json();
    expect(infos.site).toMatchObject({ adresse: "Akwa", telephone: "677 00 00 00", telephoneWhatsapp: "699 11 22 33", email: "contact@boutique.cm", siteWeb: "www.boutique.cm" });
  });

  it("un caissier ne peut pas les modifier (403) mais peut les lire pour l'impression", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    modifierSite(db, siteId, { telephone: "677 00 00 00" });
    const headers = await entetes(app, "caissier1");

    const refus = await app.inject({ method: "PATCH", url: "/api/v1/site/coordonnees", headers, payload: { telephone: "600 00 00 00" } });
    const lecture = await app.inject({ method: "GET", url: "/api/v1/entreprise", headers });

    expect(refus.statusCode).toBe(403);
    expect(lireSite().telephone).toBe("677 00 00 00");
    expect(lecture.json().site.telephone).toBe("677 00 00 00");
  });

  it("refuse une saisie invalide avec un message clair (400)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const headers = await entetes(app, "gerant1");

    const reponse = await app.inject({ method: "PATCH", url: "/api/v1/site/coordonnees", headers, payload: { email: "sans-arobase" } });

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().erreur).toMatch(/e-mail/i);
  });

  it("exige d'être connecté (401)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({ method: "PATCH", url: "/api/v1/site/coordonnees", payload: { telephone: "677 00 00 00" } });

    expect(reponse.statusCode).toBe(401);
  });
});
