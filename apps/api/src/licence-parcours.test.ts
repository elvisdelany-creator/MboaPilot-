import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "./test-utils/db.js";
import * as schema from "./db/schema.js";
import { buildApp } from "./app.js";
import { creerUtilisateur } from "./modules/utilisateurs/utilisateur.repository.js";
import { emettreCle, lireCle, type ContenuCle } from "./modules/licence/cle-renouvellement.js";
import { appliquerCleRenouvellement, calculerEtatLicence, obtenirOuCreerLicence } from "./modules/licence/licence.service.js";

// Test grandeur nature « licence » : les défauts constatés. Les paires de clés d'essai sont créées en mémoire.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publique = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const privee = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

const MOT_DE_PASSE = "motdepasse-secret";
const jour = (n = 0) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let db: Db;
let siteId: number;
let idEntreprise: number;
let idAdmin: number;

beforeEach(() => {
  db = creerDbTest();
  idEntreprise = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get().idEntreprise;
  siteId = db.insert(schema.site).values({ idEntreprise, nom: "Site A" }).returning().get().idSite;
  idAdmin = creerUtilisateur(db, { siteId, nom: "Ad", prenom: "Min", identifiant: "admin", motDePasse: MOT_DE_PASSE, role: "ADMINISTRATEUR" }).idUser;
});

afterEach(() => {
  vi.useRealTimers();
});

const ligne = () => db.select().from(schema.licence).get()!;
const regler = (valeurs: Partial<typeof schema.licence.$inferInsert>) => db.update(schema.licence).set(valeurs).run();
const audits = () => db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "licence")).all();

describe("défaut 3 : une horloge fausse au premier lancement ne condamne pas la boutique", () => {
  const AUJOURD_HUI = "2026-11-25T10:00:00.000Z";

  it("licence créée avec une horloge restée en 2000 : l'année d'essai repart quand l'heure est juste", () => {
    const creee = obtenirOuCreerLicence(db, "2000-01-05T08:00:00.000Z");

    const corrigee = obtenirOuCreerLicence(db, AUJOURD_HUI);

    expect(corrigee).toMatchObject({ idLicence: creee.idLicence, empreinteInstallation: creee.empreinteInstallation, dateExpirationAbonnement: "2027-11-25" });
    expect(calculerEtatLicence(corrigee, AUJOURD_HUI).etat).toBe("ACTIVE");
  });

  it("tant que l'horloge est fausse, rien n'est réécrit", () => {
    obtenirOuCreerLicence(db, "2000-01-05T08:00:00.000Z");

    expect(obtenirOuCreerLicence(db, "2002-06-01T08:00:00.000Z").dateExpirationAbonnement).toBe("2001-01-04");
  });

  it("un abonnement réellement expiré reste expiré", () => {
    obtenirOuCreerLicence(db, AUJOURD_HUI);
    regler({ dateExpirationAbonnement: "2026-10-01" });

    expect(obtenirOuCreerLicence(db, AUJOURD_HUI).dateExpirationAbonnement).toBe("2026-10-01");
  });
});

describe("défauts 4 et 5 : les clés se rattrapent", () => {
  const MAINTENANT = "2026-11-25T10:00:00.000Z";
  let installation: string;
  beforeEach(() => {
    installation = obtenirOuCreerLicence(db, MAINTENANT).empreinteInstallation;
  });
  const cle = (extra: Partial<ContenuCle> = {}) => emettreCle(privee, { installation, expiration: "2027-11-25", palier: "PRO", emise: "2026-11-25T09:00:00.000Z", ...extra });
  const appliquer = (texte: string, maintenant = MAINTENANT) => appliquerCleRenouvellement(db, { cle: texte, clePublique: publique, userId: idAdmin, maintenant });

  it("passage à la formule supérieure sans repousser l'échéance", () => {
    appliquer(cle());

    appliquer(cle({ palier: "RESEAU", emise: "2026-11-25T09:30:00.000Z" }));

    expect(ligne()).toMatchObject({ palier: "RESEAU", dateExpirationAbonnement: "2027-11-25" });
  });

  it("une échéance émise par erreur se corrige avec une clé plus récente, et l'erronée ne revient plus", () => {
    const erronee = cle({ expiration: "2035-08-30" });
    appliquer(erronee);

    appliquer(cle({ expiration: "2027-11-25", emise: "2026-11-25T11:00:00.000Z" }), "2026-11-25T12:00:00.000Z");

    expect(ligne().dateExpirationAbonnement).toBe("2027-11-25");
    expect(() => appliquer(erronee)).toThrow(/plus récente.*déjà appliquée|déjà appliquée/);
    expect(ligne().dateExpirationAbonnement).toBe("2027-11-25");
  });

  it("une clé déjà appliquée, ou émise avant elle, est refusée même si elle va plus loin", () => {
    appliquer(cle());

    expect(() => appliquer(cle())).toThrow(/déjà appliquée/);
    expect(() => appliquer(cle({ expiration: "2029-01-01", emise: "2026-11-20" }))).toThrow(/déjà appliquée/);
    expect(audits()).toHaveLength(1);
  });

  it("la première clé remplace une échéance saisie à la main, même plus lointaine", () => {
    regler({ dateExpirationAbonnement: "2036-11-22" });

    appliquer(cle());

    expect(ligne().dateExpirationAbonnement).toBe("2027-11-25");
  });

  it.each([
    ["entourée du message reçu", (k: string) => `Bonjour, voici votre clé : ${k} Merci et à bientôt !`],
    ["entre guillemets", (k: string) => `« "${k}" »`],
    ["après la consigne qui cite son début", (k: string) => `Elle commence par MBOA1. La voici :\n${k}\nCordialement`],
    ["coupée et semée de caractères invisibles", (k: string) => `​${k.slice(0, 30)}​\r\n ${k.slice(30)}﻿`],
  ])("clé collée %s : lue", (_nom, habiller) => {
    expect(lireCle(habiller(cle()), publique).expiration).toBe("2027-11-25");
  });

  describe("à l'activation des clés", () => {
    const maintenantReel = () => new Date().toISOString();
    const demarrer = (clePubliqueLicence = publique) => buildApp(db, { jwtSecret: "secret-de-test", clePubliqueLicence });
    beforeEach(() => regler({ derniereRevalidationReussie: maintenantReel() }));

    it("une échéance saisie à la main est ramenée à un an au plus, et le geste est tracé", () => {
      regler({ dateExpirationAbonnement: jour(3650) });

      demarrer();

      expect(ligne().dateExpirationAbonnement).toBe(jour(365));
      expect(audits()).toHaveLength(1);
      expect(audits()[0]).toMatchObject({ utilisateurId: null, action: "MODIFICATION" });
    });

    it("une échéance de moins d'un an, ou fixée par une clé, ne bouge pas", () => {
      regler({ dateExpirationAbonnement: jour(200) });
      demarrer();
      expect(ligne().dateExpirationAbonnement).toBe(jour(200));

      appliquerCleRenouvellement(db, { cle: cle({ expiration: jour(900), emise: maintenantReel() }), clePublique: publique, userId: idAdmin });
      demarrer();
      expect(ligne().dateExpirationAbonnement).toBe(jour(900));
    });

    it("horloge reculée au démarrage : rien n'est raccourci", () => {
      regler({ dateExpirationAbonnement: jour(3650), derniereRevalidationReussie: new Date(Date.now() + 30 * 86_400_000).toISOString() });

      demarrer();

      expect(ligne().dateExpirationAbonnement).toBe(jour(3650));
    });

    it("sans clé publique (pilote), l'échéance saisie reste", () => {
      regler({ dateExpirationAbonnement: jour(3650) });

      demarrer("");

      expect(ligne().dateExpirationAbonnement).toBe(jour(3650));
    });
  });
});

describe("défaut 2 : chaque formule ouvre ce que prévoit le cahier des charges (10.1)", () => {
  let idApporteur: number;
  beforeEach(() => {
    obtenirOuCreerLicence(db, new Date().toISOString());
    idApporteur = db.insert(schema.sousDistributeur).values({ nom: "Apporteur existant", tauxCommissionDefaut: 100 }).returning().get().idApporteur;
    for (const [identifiant, role] of [["gerant", "GERANT"], ["caissier", "CAISSIER"], ["technicien", "TECHNICIEN_SAV"]] as const) {
      creerUtilisateur(db, { siteId, nom: "N", prenom: identifiant, identifiant, motDePasse: MOT_DE_PASSE, role });
    }
  });

  async function boutique(palier: string, clePubliqueLicence: string | undefined = publique) {
    regler({ palier });
    const app = buildApp(db, { jwtSecret: "secret-de-test", clePubliqueLicence });
    const jetons: Record<string, string> = {};
    const connecter = async (identifiant: string) => {
      const r = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse: MOT_DE_PASSE } });
      if (r.statusCode === 200) jetons[identifiant] = r.json().token;
      return r;
    };
    const appel = (qui: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
      app.inject({ method, url, payload, headers: { authorization: `Bearer ${jetons[qui]}` } });
    return { app, connecter, appel };
  }
  const refus = (r: { statusCode: number; json: () => { erreur?: string } }, motif: RegExp) => {
    expect(r.statusCode).toBe(403);
    expect(r.json().erreur).toMatch(motif);
  };
  const nouvelApporteur = { nom: "Nouveau", tauxCommissionDefaut: 100 };
  const compteApporteur = () => ({ siteId, nom: "A", prenom: "P", identifiant: "partenaire", motDePasse: MOT_DE_PASSE, role: "APPORTEUR", idApporteur });
  const periode = "?du=2026-01-01&au=2026-12-31";

  it("Essentiel : une seule boutique", async () => {
    const { connecter, appel } = await boutique("ESSENTIEL");
    await connecter("admin");

    refus(await appel("admin", "POST", "/api/v1/sites", { nom: "Boutique 2" }), /Réseau/);
    expect(db.select().from(schema.site).all()).toHaveLength(1);
  });

  it("une boutique désactivée ne se réactive pas au-delà de la formule", async () => {
    const second = db.insert(schema.site).values({ idEntreprise, nom: "Ancienne", actif: 0 }).returning().get().idSite;
    const { connecter, appel } = await boutique("PRO");
    await connecter("admin");

    refus(await appel("admin", "PATCH", `/api/v1/sites/${second}`, { actif: true }), /Réseau/);
    expect((await appel("admin", "PATCH", `/api/v1/sites/${siteId}`, { nom: "Site renommé" })).statusCode).toBe(200);
  });

  it("Essentiel : ni nouvel apporteur, ni compte apporteur, ni rattachement d'un apporteur", async () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555" }).returning().get().idAbonne;
    const { connecter, appel } = await boutique("ESSENTIEL");
    await connecter("admin");

    refus(await appel("admin", "POST", "/api/v1/apporteurs", nouvelApporteur), /Pro/);
    refus(await appel("admin", "POST", "/api/v1/utilisateurs", compteApporteur()), /Pro/);
    refus(await appel("admin", "PATCH", `/api/v1/abonnes/${abonne}`, { apporteurId: idApporteur }), /Pro/);
    refus(await appel("admin", "POST", "/api/v1/recrutements", { apporteurId: idApporteur }), /Pro/);
    refus(await appel("admin", "POST", "/api/v1/abonnements/reprise", { abonne: { nom: "R", prenom: "P", apporteurId: idApporteur } }), /Pro/);
  });

  it("Essentiel : ce qui existe déjà reste consultable et modifiable, et les commissions dues se règlent", async () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555", apporteurId: idApporteur }).returning().get().idAbonne;
    const { connecter, appel } = await boutique("ESSENTIEL");
    await connecter("admin");

    expect((await appel("admin", "GET", "/api/v1/apporteurs")).statusCode).toBe(200);
    expect((await appel("admin", "PATCH", `/api/v1/abonnes/${abonne}`, { telephone: "699111222", apporteurId: idApporteur })).statusCode).toBe(200);
    expect((await appel("admin", "PATCH", `/api/v1/abonnes/${abonne}`, { apporteurId: null })).statusCode).toBe(200);
    const reglement = await appel("admin", "POST", `/api/v1/apporteurs/${idApporteur}/reglements`, { montant: 1000, modePaiement: "CASH" });
    expect(reglement.json().erreur ?? "").not.toMatch(/formule/);
  });

  it("Essentiel : pas d'export comptable, mais l'export de ses données reste", async () => {
    const { connecter, appel } = await boutique("ESSENTIEL");
    await connecter("admin");

    for (const chemin of ["apercu", "ventes", "encaissements"]) refus(await appel("admin", "GET", `/api/v1/export-comptable/${chemin}${periode}`), /Pro/);
  });

  it("Pro : apporteurs et export comptable, toujours une seule boutique, connexions sans limite", async () => {
    const { connecter, appel } = await boutique("PRO");
    for (const qui of ["admin", "gerant", "caissier", "technicien"]) expect((await connecter(qui)).statusCode).toBe(200);

    expect((await appel("admin", "POST", "/api/v1/apporteurs", nouvelApporteur)).statusCode).toBe(201);
    expect((await appel("admin", "GET", `/api/v1/export-comptable/apercu${periode}`)).statusCode).toBe(200);
    refus(await appel("admin", "POST", "/api/v1/sites", { nom: "Boutique 2" }), /Réseau/);
  });

  it("Réseau : plusieurs boutiques", async () => {
    const { connecter, appel } = await boutique("RESEAU");
    await connecter("admin");

    expect((await appel("admin", "POST", "/api/v1/sites", { nom: "Boutique 2" })).statusCode).toBe(201);
  });

  it("pilote (sans clé publique) : aucune limite, aucune formule n'y étant attribuable", async () => {
    const { connecter, appel } = await boutique("ESSENTIEL", "");
    for (const qui of ["admin", "gerant", "caissier", "technicien"]) expect((await connecter(qui)).statusCode).toBe(200);

    expect((await appel("admin", "POST", "/api/v1/sites", { nom: "Boutique 2" })).statusCode).toBe(201);
    expect((await appel("admin", "POST", "/api/v1/apporteurs", nouvelApporteur)).statusCode).toBe(201);
    expect((await appel("admin", "GET", `/api/v1/export-comptable/apercu${periode}`)).statusCode).toBe(200);
  });

  describe("Essentiel : deux personnes connectées en même temps", () => {
    it("la troisième est refusée avec un message qui dit quoi faire", async () => {
      const { connecter } = await boutique("ESSENTIEL");
      await connecter("gerant");
      await connecter("caissier");

      refus(await connecter("technicien"), /2 personnes.*se déconnecter/);
    });

    it("la même personne sur un deuxième appareil ne prend pas une place de plus", async () => {
      const { connecter } = await boutique("ESSENTIEL");
      await connecter("gerant");
      await connecter("gerant");

      expect((await connecter("caissier")).statusCode).toBe(200);
    });

    it("une déconnexion libère la place", async () => {
      const { connecter, appel } = await boutique("ESSENTIEL");
      await connecter("gerant");
      await connecter("caissier");

      expect((await appel("caissier", "POST", "/api/v1/auth/deconnexion", {})).statusCode).toBe(200);

      expect((await connecter("technicien")).statusCode).toBe(200);
    });

    it("quinze minutes sans activité libèrent la place ; revenir quand deux autres travaillent est refusé", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const debut = Date.now();
      const { connecter, appel } = await boutique("ESSENTIEL");
      await connecter("gerant");
      await connecter("caissier");

      vi.setSystemTime(debut + 16 * 60_000);
      expect((await connecter("technicien")).statusCode).toBe(200);
      expect((await appel("caissier", "GET", "/api/v1/produits")).statusCode).toBe(200);
      refus(await appel("gerant", "GET", "/api/v1/produits"), /2 personnes/);
    });

    it("les vérifications automatiques d'un écran ouvert n'occupent pas de place", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const debut = Date.now();
      const { connecter, appel } = await boutique("ESSENTIEL");
      await connecter("gerant");
      await connecter("caissier");

      vi.setSystemTime(debut + 16 * 60_000);
      expect((await appel("gerant", "GET", "/api/v1/auth/moi")).statusCode).toBe(200);
      expect((await appel("gerant", "POST", "/api/v1/auth/renouveler", {})).statusCode).toBe(200);
      expect((await appel("caissier", "GET", "/api/v1/licence/etat")).statusCode).toBe(200);

      expect((await connecter("technicien")).statusCode).toBe(200);
      expect((await connecter("caissier")).statusCode).toBe(200);
    });

    it("un refus n'exécute rien : la demande d'une troisième personne n'écrit pas", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const debut = Date.now();
      const { connecter, appel } = await boutique("ESSENTIEL");
      await connecter("technicien");
      vi.setSystemTime(debut + 16 * 60_000);
      await connecter("gerant");
      await connecter("caissier");

      const r = await appel("technicien", "POST", "/api/v1/sav/dossiers", { descriptionPanne: "Panne", sousGarantie: false });

      refus(r, /2 personnes/);
      expect(db.select().from(schema.savDossier).all()).toHaveLength(0);
    });

    it("sans jeton ou avec un compte désactivé : 401, et aucune place prise", async () => {
      const { app, connecter, appel } = await boutique("ESSENTIEL");
      await connecter("technicien");
      db.update(schema.utilisateur).set({ actif: 0 }).where(eq(schema.utilisateur.identifiant, "technicien")).run();

      expect((await app.inject({ method: "GET", url: "/api/v1/produits" })).statusCode).toBe(401);
      expect((await appel("technicien", "GET", "/api/v1/produits")).statusCode).toBe(401);
    });

    it("l'administrateur entre toujours : c'est lui qui renouvelle la licence", async () => {
      const { connecter, appel } = await boutique("ESSENTIEL");
      await connecter("gerant");
      await connecter("caissier");

      expect((await connecter("admin")).statusCode).toBe(200);
      expect((await appel("admin", "GET", "/api/v1/produits")).statusCode).toBe(200);
    });
  });
});
