import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";
import { authentifier } from "./auth.service.js";
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
  });
});
