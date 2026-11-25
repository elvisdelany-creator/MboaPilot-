import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "./test-utils/db.js";
import * as schema from "./db/schema.js";
import { executerJobQuotidien } from "./modules/jobs/job-quotidien.service.js";
import { creerUtilisateur, modifierUtilisateur, reinitialiserMotDePasse } from "./modules/utilisateurs/utilisateur.repository.js";
import { modifierEntreprise } from "./modules/entreprise/entreprise.repository.js";
import { creerDossierSav } from "./modules/sav/sav.repository.js";
import { changerStatutSav } from "./modules/sav/sav.service.js";

// Test grandeur nature « reprise sur panne » : une coupure (courant, processus tué) entre deux écritures liées ne doit rien laisser à moitié fait.

let db: Db;
let siteId: number;
let idEntreprise: number;
let userId: number;
let idAbonne: number;
let idFormule: number;

beforeEach(() => {
  db = creerDbTest();
  idEntreprise = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get().idEntreprise;
  siteId = db.insert(schema.site).values({ idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db.insert(schema.utilisateur).values({ siteId, nom: "Nga", prenom: "Paul", identifiant: "pnga", motDePasseHash: "h", role: "ADMINISTRATEUR" }).returning().get().idUser;
  idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Marie", telephone: "677000555", email: "marie@example.test" }).returning().get().idAbonne;
  const idFamille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get().idFamille;
  idFormule = db.insert(schema.formule).values({ idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const instantane = (base: Db) =>
  (base.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
    ({ name }) => [name, base.$client.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()],
  );

// joue `operation` en coupant juste avant la `n`-ième écriture SQL ; dit si la coupure a eu lieu (faux : moins de n écritures)
function jouerAvecCoupure(base: Db, n: number, operation: () => unknown): boolean {
  const original = base.$client.prepare.bind(base.$client);
  let ecritures = 0;
  let coupe = false;
  const espion = vi.spyOn(base.$client, "prepare").mockImplementation(((texte: string) => {
    if (/^\s*(insert|update|delete)\b/i.test(texte) && ++ecritures === n) {
      coupe = true;
      throw new Error("coupure simulée");
    }
    return original(texte);
  }) as typeof base.$client.prepare);
  try {
    operation();
  } catch (erreur) {
    if (!coupe) throw erreur;
  } finally {
    espion.mockRestore();
  }
  return coupe;
}

// coupe avant la 1re écriture, puis la 2e, etc. : après chaque coupure, la base est exactement dans l'état d'avant
function exigerToutOuRien(operation: () => unknown): number {
  for (let n = 1; n < 50; n++) {
    const avant = instantane(db);
    if (!jouerAvecCoupure(db, n, operation)) return n - 1;
    expect(instantane(db), `coupure avant l'écriture n° ${n}`).toEqual(avant);
  }
  throw new Error("trop d'écritures");
}

describe("les gestes sensibles ne restent jamais sans leur trace", () => {
  const compte = { siteId: 0, nom: "Fotso", prenom: "Eric", identifiant: "efotso", motDePasse: "Motdepasse-2026", role: "CAISSIER" as const };

  it("création de compte", () => {
    expect(exigerToutOuRien(() => creerUtilisateur(db, { ...compte, siteId }, userId))).toBeGreaterThanOrEqual(2);
  });

  it("changement de rôle", () => {
    expect(exigerToutOuRien(() => modifierUtilisateur(db, userId, { role: "COMPTABLE" }, userId))).toBeGreaterThanOrEqual(2);
  });

  it("réinitialisation de mot de passe", () => {
    expect(exigerToutOuRien(() => reinitialiserMotDePasse(db, userId, "Motdepasse-2027", userId))).toBeGreaterThanOrEqual(2);
  });

  it("réglages de l'entreprise", () => {
    expect(exigerToutOuRien(() => modifierEntreprise(db, idEntreprise, { tauxTva: 1900 }, userId))).toBeGreaterThanOrEqual(2);
  });

  it("ouverture d'un dossier SAV avec son historique", () => {
    expect(exigerToutOuRien(() => creerDossierSav(db, { siteId, idAbonne, descriptionPanne: "Écran noir", sousGarantie: false, userId }))).toBeGreaterThanOrEqual(2);
  });
});

describe("tâche quotidienne : un rappel interrompu est repris, jamais perdu", () => {
  const AUJOURD_HUI = "2026-11-25";
  const etat = (base: Db) => ({
    expires: base.select().from(schema.abonnement).all().filter((a) => a.statut === "EXPIRE").length,
    alertes: base.select().from(schema.alerteEcheance).all().map((a) => `${a.numeroAbonnement}/${a.jalonJours}`).sort(),
    messages: base
      .select()
      .from(schema.notification)
      .all()
      .map((n) => `${n.canal}:${n.message}`)
      .sort(),
  });
  const copie = (tampon: Buffer): Db => {
    const sqlite = new Database(tampon);
    sqlite.pragma("foreign_keys = ON");
    return drizzle(sqlite, { schema });
  };

  it("quel que soit l'instant de la coupure, la reprise aboutit au même résultat que sans panne", () => {
    const abonnement = (dateFin: string) =>
      db.insert(schema.abonnement).values({ idAbonne, idFormule, siteId, dateDebut: "2026-10-01", dateFin, statut: "ACTIF", creePar: userId }).run();
    abonnement("2026-11-26");
    abonnement("2026-11-28");
    abonnement("2026-11-10");
    const depart = db.$client.serialize();

    const reference = copie(depart);
    executerJobQuotidien(reference, AUJOURD_HUI);
    const attendu = etat(reference);
    expect(attendu.alertes).toHaveLength(2);
    expect(attendu.messages).toHaveLength(4); // SMS et e-mail pour chacun

    for (let n = 1; n < 50; n++) {
      const base = copie(depart);
      const coupe = jouerAvecCoupure(base, n, () => executerJobQuotidien(base, AUJOURD_HUI));
      if (!coupe) break;
      executerJobQuotidien(base, AUJOURD_HUI);
      expect(etat(base), `coupure avant l'écriture n° ${n}, puis reprise`).toEqual(attendu);
    }
  });
});

// Attendre le disque à chaque ligne figeait la caisse 15 s pour 4 000 rappels (8 s auparavant). La tâche quotidienne est entièrement
// rejouable : ce qu'une coupure de courant effacerait est refait au démarrage suivant.
describe("tâche quotidienne : seule elle n'attend pas le disque à chaque écriture", () => {
  const reglage = () => db.$client.pragma("synchronous", { simple: true });
  const echeanceProche = () => {
    db.$client.pragma("synchronous = FULL");
    db.insert(schema.abonnement).values({ idAbonne, idFormule, siteId, dateDebut: "2026-10-01", dateFin: "2026-11-28", statut: "ACTIF", creePar: userId }).run();
  };

  it("réglage rapide pendant la tâche, réglage strict rétabli ensuite", () => {
    echeanceProche();
    const pendant: unknown[] = [];

    executerJobQuotidien(db, "2026-11-25", {
      envoyer: () => {
        pendant.push(reglage());
        return { reussi: true, simule: true };
      },
    });

    expect(pendant).toEqual([1, 1]);
    expect(reglage()).toBe(2);
  });

  it("réglage strict rétabli même quand la tâche échoue", () => {
    echeanceProche();

    expect(jouerAvecCoupure(db, 1, () => executerJobQuotidien(db, "2026-11-25"))).toBe(true);

    expect(reglage()).toBe(2);
  });

  it("appelée à l'intérieur d'une transaction, la tâche s'exécute sans toucher au réglage", () => {
    echeanceProche();

    expect(() => db.transaction(() => executerJobQuotidien(db, "2026-11-25"))).not.toThrow();
    expect(reglage()).toBe(2);
  });
});

describe("SAV « Prêt » : un message non enregistré n'annonce pas un échec", () => {
  const preparer = (client: { idAbonne: number } | { clientNom: string; clientTelephone: string }) => {
    const dossier = creerDossierSav(db, { siteId, userId, descriptionPanne: "Écran noir", sousGarantie: false, ...client });
    changerStatutSav(db, { idDossierSav: dossier.idDossierSav, nouveauStatut: "DIAGNOSTIC", userId });
    changerStatutSav(db, { idDossierSav: dossier.idDossierSav, nouveauStatut: "REPARATION", userId });
    return dossier.idDossierSav;
  };

  it.each([
    ["abonné", () => ({ idAbonne })],
    ["client de passage", () => ({ clientNom: "Passage", clientTelephone: "699000111" })],
  ])("%s : le passage en Prêt réussit, l'incident est journalisé", (_nom, client) => {
    const idDossierSav = preparer(client());
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = db.$client.prepare.bind(db.$client);
    vi.spyOn(db.$client, "prepare").mockImplementation(((texte: string) => {
      if (/^\s*insert into "notification"/i.test(texte)) throw new Error("disque plein");
      return original(texte);
    }) as typeof db.$client.prepare);

    const resultat = changerStatutSav(db, { idDossierSav, nouveauStatut: "PRET", montantMainOeuvre: 5000, userId });

    expect(resultat.statut).toBe("PRET");
    expect(resultat.montantFacture).toBe(5000);
    expect(db.select().from(schema.savDossier).where(eq(schema.savDossier.idDossierSav, idDossierSav)).get()?.statut).toBe("PRET");
    expect(journal).toHaveBeenCalledWith(expect.stringContaining(`dossier SAV ${idDossierSav}`), expect.any(Error));
  });
});
