import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";
import { authentifier, changerSonMotDePasse } from "./auth.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  creerUtilisateur(db, {
    siteId,
    nom: "Nga Ndongo",
    prenom: "Valentin",
    identifiant: "vnga",
    motDePasse: "motdepasse-secret",
    role: "CAISSIER",
  });
});

describe("authentifier (2.5.1, 11.2)", () => {
  it("authentifie avec le bon identifiant et mot de passe, sans exposer le hash", () => {
    const utilisateur = authentifier(db, "vnga", "motdepasse-secret");

    expect(utilisateur.identifiant).toBe("vnga");
    expect(utilisateur).not.toHaveProperty("motDePasseHash");
  });

  it("rejette un mot de passe incorrect", () => {
    expect(() => authentifier(db, "vnga", "mauvais-mot-de-passe")).toThrow(/identifiants/i);
  });

  it("rejette un identifiant inconnu avec le même message générique (pas d'énumération de comptes)", () => {
    let messageInconnu: string | undefined;
    let messageMauvaisMdp: string | undefined;
    try {
      authentifier(db, "inconnu", "peu importe");
    } catch (e) {
      messageInconnu = (e as Error).message;
    }
    try {
      authentifier(db, "vnga", "mauvais-mot-de-passe");
    } catch (e) {
      messageMauvaisMdp = (e as Error).message;
    }
    expect(messageInconnu).toBe(messageMauvaisMdp);
  });

  it("rejette un compte désactivé", () => {
    db.update(schema.utilisateur).set({ actif: 0 }).where(eq(schema.utilisateur.identifiant, "vnga")).run();

    expect(() => authentifier(db, "vnga", "motdepasse-secret")).toThrow(/identifiants/i);
  });

  it("11.2 : verrouille le compte après 5 échecs consécutifs, même avec le bon mot de passe ensuite", () => {
    for (let i = 0; i < 5; i++) {
      expect(() => authentifier(db, "vnga", "mauvais-mot-de-passe")).toThrow(/identifiants/i);
    }

    expect(() => authentifier(db, "vnga", "motdepasse-secret")).toThrow(/verrouill/i);
  });

  it("11.2 : réinitialise le compteur d'échecs après une connexion réussie", () => {
    expect(() => authentifier(db, "vnga", "mauvais-mot-de-passe")).toThrow(/identifiants/i);
    expect(() => authentifier(db, "vnga", "mauvais-mot-de-passe")).toThrow(/identifiants/i);
    authentifier(db, "vnga", "motdepasse-secret"); // succès -> remise à zéro

    for (let i = 0; i < 4; i++) {
      expect(() => authentifier(db, "vnga", "mauvais-mot-de-passe")).toThrow(/identifiants/i);
    }
    // 4 échecs seulement depuis la remise à zéro : pas encore verrouillé
    expect(authentifier(db, "vnga", "motdepasse-secret").identifiant).toBe("vnga");
  });

  it("11.2 : déverrouille automatiquement une fois le délai de verrouillage écoulé", () => {
    for (let i = 0; i < 5; i++) {
      expect(() => authentifier(db, "vnga", "mauvais-mot-de-passe", "2026-01-01T10:00:00.000Z")).toThrow(/identifiants/i);
    }
    expect(() => authentifier(db, "vnga", "motdepasse-secret", "2026-01-01T10:05:00.000Z")).toThrow(/verrouill/i);

    const utilisateur = authentifier(db, "vnga", "motdepasse-secret", "2026-01-01T10:20:00.000Z");
    expect(utilisateur.identifiant).toBe("vnga");

    // le compteur était déjà à 0 au moment du verrouillage (mis à 0 par
    // enregistrerEchecConnexion) : la remise à zéro conditionnée à
    // "tentativesEchouees > 0" ne suffit pas à effacer un verrouilleJusqua
    // désormais expiré — il doit être explicitement remis à null
    const ligne = db.select().from(schema.utilisateur).where(eq(schema.utilisateur.identifiant, "vnga")).get();
    expect(ligne?.verrouilleJusqua).toBeNull();
  });
});

// 2.5.1, 11.2 : constaté par fuzz de la route de connexion — un identifiant ou un mot de
// passe qui n'est pas un texte faisait remonter des messages internes (« Illegal
// arguments: number, string » de bcrypt, « Too few parameter values » de SQLite) au
// lieu du message générique « Identifiants invalides ».
describe("authentifier : entrées qui ne sont pas des textes (11.2)", () => {
  it.each([
    [{ x: 1 }, "motdepasse-secret"],
    [["vnga"], "motdepasse-secret"],
    [null, "motdepasse-secret"],
    [undefined, "motdepasse-secret"],
    ["vnga", 123],
    ["vnga", null],
    ["vnga", undefined],
    ["vnga", { $ne: "" }],
    ["vnga", ["motdepasse-secret"]],
  ])("refuse (%j, %j) avec le message générique, sans compter d'échec", (identifiant, motDePasse) => {
    expect(() => authentifier(db, identifiant as never, motDePasse as never)).toThrow(/^Identifiants invalides$/);
    const utilisateur = db.select().from(schema.utilisateur).where(eq(schema.utilisateur.identifiant, "vnga")).get();
    expect(utilisateur?.tentativesEchouees).toBe(0);
  });
});

// 2.5.1 : « authentification individuelle obligatoire ». Seul un administrateur pouvait changer un mot de passe,
// donc il connaissait celui de chaque utilisateur : chacun doit pouvoir choisir le sien.
describe("changerSonMotDePasse (2.5.1, 11.2)", () => {
  const idVnga = () => db.select().from(schema.utilisateur).where(eq(schema.utilisateur.identifiant, "vnga")).get()!.idUser;

  it("remplace le mot de passe quand l'actuel est correct ; l'ancien ne marche plus, le nouveau oui", () => {
    changerSonMotDePasse(db, idVnga(), "motdepasse-secret", "nouveau-motdepasse-42");

    expect(() => authentifier(db, "vnga", "motdepasse-secret")).toThrow(/identifiants/i);
    expect(authentifier(db, "vnga", "nouveau-motdepasse-42").identifiant).toBe("vnga");
  });

  it("refuse un mot de passe actuel incorrect, sans rien changer, et compte l'échec (anti force brute)", () => {
    expect(() => changerSonMotDePasse(db, idVnga(), "pas-le-bon", "nouveau-motdepasse-42")).toThrow(/actuel est incorrect/i);

    expect(authentifier(db, "vnga", "motdepasse-secret").identifiant).toBe("vnga");
    for (let i = 0; i < 5; i++) expect(() => changerSonMotDePasse(db, idVnga(), "pas-le-bon", "nouveau-motdepasse-42")).toThrow();
    expect(() => authentifier(db, "vnga", "motdepasse-secret")).toThrow(/verrouillé/i);
  });

  it("applique la politique de complexité de l'entreprise au nouveau mot de passe", () => {
    expect(() => changerSonMotDePasse(db, idVnga(), "motdepasse-secret", "court")).toThrow();
    expect(authentifier(db, "vnga", "motdepasse-secret").identifiant).toBe("vnga");
  });

  it("refuse un nouveau mot de passe identique à l'actuel", () => {
    expect(() => changerSonMotDePasse(db, idVnga(), "motdepasse-secret", "motdepasse-secret")).toThrow(/différent/i);
  });

  it("journalise le changement (sans le mot de passe), au nom de l'utilisateur lui-même", () => {
    const id = idVnga();
    changerSonMotDePasse(db, id, "motdepasse-secret", "nouveau-motdepasse-42");

    const trace = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "utilisateur")).all().filter((t) => t.idCible === String(id)).at(-1)!;
    expect(trace.utilisateurId).toBe(id);
    expect(trace.valeurApres).toContain("changement_mot_de_passe");
    expect(trace.valeurApres).not.toContain("nouveau-motdepasse-42");
  });

  it("refuse des mots de passe qui ne sont pas du texte", () => {
    expect(() => changerSonMotDePasse(db, idVnga(), { a: 1 } as never, "nouveau-motdepasse-42")).toThrow();
    expect(() => changerSonMotDePasse(db, idVnga(), "motdepasse-secret", 12345678 as never)).toThrow();
  });
});

