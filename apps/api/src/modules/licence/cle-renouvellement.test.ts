import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";
import { emettreCle, lireCle, type ContenuCle } from "./cle-renouvellement.js";
import { appliquerCleRenouvellement, calculerEtatLicence, obtenirOuCreerLicence } from "./licence.service.js";

// 10.4 : « jeton de licence signé ». La boutique ne peut plus prolonger elle-même son abonnement en saisissant une date : elle colle une clé
// que seul l'éditeur sait produire (signature Ed25519), émise pour son installation. Les paires de clés d'essai sont créées en mémoire.
function paire() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publique: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privee: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}
const editeur = paire();
const imposteur = paire();

const MAINTENANT = "2026-11-25T10:00:00.000Z";
let db: Db;
let installation: string;
let idAdmin: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  const siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  idAdmin = creerUtilisateur(db, { siteId, nom: "Ad", prenom: "Min", identifiant: "admin", motDePasse: "motdepasse-secret", role: "ADMINISTRATEUR" }).idUser;
  installation = obtenirOuCreerLicence(db, MAINTENANT).empreinteInstallation;
});

const contenu = (extra: Partial<ContenuCle> = {}): ContenuCle => ({ installation, expiration: "2028-06-30", palier: "PRO", emise: "2026-11-25", ...extra });
const cleValide = (extra: Partial<ContenuCle> = {}) => emettreCle(editeur.privee, contenu(extra));
const appliquer = (cle: unknown, maintenant = MAINTENANT) => appliquerCleRenouvellement(db, { cle: cle as string, clePublique: editeur.publique, userId: idAdmin, maintenant });
const licence = () => obtenirOuCreerLicence(db, MAINTENANT);
const audits = () => db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "licence")).all();

describe("clé de renouvellement : forme et signature", () => {
  it("une clé émise par l'éditeur se relit avec son contenu", () => {
    const cle = cleValide();
    expect(cle).toMatch(/^MBOA1\.[\w-]+\.[\w-]+$/);
    expect(lireCle(cle, editeur.publique)).toEqual(contenu());
  });

  it("collée depuis un message, avec espaces et retours à la ligne, elle se lit quand même", () => {
    const cle = cleValide();
    const abimee = `  ${cle.slice(0, 20)}\r\n${cle.slice(20, 60)} ${cle.slice(60)}\n`;
    expect(lireCle(abimee, editeur.publique)).toEqual(contenu());
  });

  it("une clé signée par quelqu'un d'autre est refusée", () => {
    expect(() => lireCle(emettreCle(imposteur.privee, contenu()), editeur.publique)).toThrow(/pas été signée par l'éditeur/);
  });

  it("modifier l'échéance d'une vraie clé invalide sa signature", () => {
    const [prefixe, , signature] = cleValide().split(".");
    const truque = Buffer.from(JSON.stringify(contenu({ expiration: "2035-01-01" }))).toString("base64url");
    expect(() => lireCle(`${prefixe}.${truque}.${signature}`, editeur.publique)).toThrow(/pas été signée par l'éditeur/);
  });

  it.each([
    ["absente", undefined, /obligatoire/],
    ["vide", "   ", /obligatoire/],
    ["un nombre", 12, /obligatoire/],
    ["du texte quelconque", "bonjour", /illisible/],
    ["un autre préfixe", "MBOA9.abc.def", /illisible/],
    ["tronquée", "MBOA1.eyJ2IjoxfQ", /illisible/],
    ["démesurée", `MBOA1.${"a".repeat(5000)}.b`, /illisible/],
  ])("une clé %s est refusée avec un message clair", (_nom, cle, message) => {
    expect(() => lireCle(cle, editeur.publique)).toThrow(message);
  });

  it("une clé bien signée mais au contenu incomplet est refusée", () => {
    const incomplet = emettreCle(editeur.privee, { installation } as ContenuCle);
    expect(() => lireCle(incomplet, editeur.publique)).toThrow(/illisible/);
  });
});

describe("appliquer une clé de renouvellement", () => {
  it("prolonge l'abonnement, change la formule, revalide la licence et trace le geste", () => {
    db.update(schema.licence).set({ dateExpirationAbonnement: "2026-11-01", derniereRevalidationReussie: "2026-09-01T00:00:00.000Z" }).run();
    expect(calculerEtatLicence(licence(), MAINTENANT).etat).toBe("DEGRADE");

    appliquer(cleValide());

    expect(licence()).toMatchObject({ dateExpirationAbonnement: "2028-06-30", palier: "PRO", derniereRevalidationReussie: MAINTENANT });
    expect(calculerEtatLicence(licence(), MAINTENANT).etat).toBe("ACTIVE");
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ utilisateurId: idAdmin, action: "MODIFICATION" });
    expect(JSON.parse(audits()[0].valeurApres!)).toMatchObject({ dateExpirationAbonnement: "2028-06-30", palier: "PRO" });
  });

  it("refuse une clé émise pour une autre installation, en donnant l'identifiant de celle-ci", () => {
    expect(() => appliquer(cleValide({ installation: "une-autre-boutique" }))).toThrow(new RegExp(`autre installation.*${installation}`));
    expect(audits()).toHaveLength(0);
  });

  it("refuse une clé déjà expirée", () => {
    expect(() => appliquer(cleValide({ expiration: "2026-11-25" }))).toThrow(/déjà expirée/);
  });

  it("refuse de rejouer une clé, ou d'appliquer une clé qui ne prolonge pas", () => {
    appliquer(cleValide());
    expect(() => appliquer(cleValide())).toThrow(/ne prolonge pas/);
    expect(() => appliquer(cleValide({ expiration: "2027-01-01" }))).toThrow(/ne prolonge pas.*2028-06-30/);
    expect(licence().dateExpirationAbonnement).toBe("2028-06-30");
    expect(audits()).toHaveLength(1);
  });

  it.each([
    ["une date impossible", { expiration: "2028-02-30" }, /date/],
    ["une échéance à plus de 10 ans (faute de frappe)", { expiration: "2206-01-01" }, /10 ans/],
    ["une formule inconnue", { palier: "ILLIMITE" }, /formule/i],
  ])("refuse %s", (_nom, extra, message) => {
    expect(() => appliquer(cleValide(extra))).toThrow(message);
    expect(audits()).toHaveLength(0);
  });
});

describe("routes de la licence", () => {
  async function ouvrir(clePubliqueLicence?: string) {
    const app = buildApp(db, { jwtSecret: "secret-de-test", clePubliqueLicence });
    const token = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "admin", motDePasse: "motdepasse-secret" } })).json().token;
    const appeler = (method: "GET" | "POST" | "PUT", url: string, payload?: object, jeton = token) =>
      app.inject({ method, url, payload, headers: { authorization: `Bearer ${jeton}` } });
    return { app, appeler };
  }
  // les routes lisent l'heure réelle : une échéance relative à aujourd'hui
  const dansJours = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  it("avec la clé publique de l'éditeur : la saisie d'une date est refusée, la clé prolonge, même en lecture seule", async () => {
    const { appeler } = await ouvrir(editeur.publique);
    db.update(schema.licence).set({ dateExpirationAbonnement: "2020-01-01" }).run();

    expect((await appeler("GET", "/api/v1/licence/etat")).json()).toMatchObject({ renouvellementParCle: true, empreinteInstallation: installation, etat: "DEGRADE" });
    const parDate = await appeler("PUT", "/api/v1/licence/expiration", { dateExpiration: dansJours(3000) });
    expect(parDate.statusCode).toBe(400);
    expect(parDate.json().erreur).toMatch(/clé de renouvellement/);
    expect(licence().dateExpirationAbonnement).toBe("2020-01-01");

    const parCle = await appeler("POST", "/api/v1/licence/cle", { cle: cleValide({ expiration: dansJours(365) }) });
    expect(parCle.statusCode).toBe(200);
    expect(parCle.json()).toMatchObject({ etat: "ACTIVE", dateExpirationAbonnement: dansJours(365), palier: "PRO" });
  });

  it("une mauvaise clé donne un 400 qui dit pourquoi, un corps vide aussi", async () => {
    const { appeler } = await ouvrir(editeur.publique);
    const fausse = await appeler("POST", "/api/v1/licence/cle", { cle: emettreCle(imposteur.privee, contenu({ expiration: dansJours(365) })) });
    expect(fausse.statusCode).toBe(400);
    expect(fausse.json().erreur).toMatch(/pas été signée par l'éditeur/);
    const vide = await appeler("POST", "/api/v1/licence/cle", {});
    expect(vide.statusCode).toBe(400);
    expect(vide.json().erreur).toMatch(/obligatoire/);
  });

  it("seul un administrateur applique une clé", async () => {
    const siteId = db.select().from(schema.site).get()!.idSite;
    creerUtilisateur(db, { siteId, nom: "Ge", prenom: "Rant", identifiant: "gerant", motDePasse: "motdepasse-secret", role: "GERANT" });
    const { app, appeler } = await ouvrir(editeur.publique);
    const jeton = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant: "gerant", motDePasse: "motdepasse-secret" } })).json().token;

    expect((await appeler("POST", "/api/v1/licence/cle", { cle: cleValide({ expiration: dansJours(365) }) }, jeton)).statusCode).toBe(403);
  });

  // tant que l'éditeur n'a pas inscrit sa clé publique, rien ne change pour les installations existantes
  it("sans clé publique : la saisie de date reste possible et la route des clés le dit", async () => {
    const { appeler } = await ouvrir(undefined);

    expect((await appeler("GET", "/api/v1/licence/etat")).json()).toMatchObject({ renouvellementParCle: false });
    expect((await appeler("PUT", "/api/v1/licence/expiration", { dateExpiration: dansJours(800) })).statusCode).toBe(200);
    const parCle = await appeler("POST", "/api/v1/licence/cle", { cle: cleValide({ expiration: dansJours(900) }) });
    expect(parCle.statusCode).toBe(400);
    expect(parCle.json().erreur).toMatch(/n'est pas activé/);
  });

  // une faute dans la clé publique inscrite ne doit pas rouvrir en silence la saisie libre d'une date
  it("une clé publique illisible n'est pas traitée comme absente", async () => {
    expect(() => buildApp(db, { jwtSecret: "secret-de-test", clePubliqueLicence: "pas-une-cle" })).toThrow(/clé publique de l'éditeur/i);
  });
});
