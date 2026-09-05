import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { envoyerNotificationAbonne, listerNotificationsAbonne } from "./notification.service.js";
import type { FournisseurNotification } from "./fournisseur.js";

let db: Db;
let siteId: number;

class FournisseurFactice implements FournisseurNotification {
  reussi = true;
  envoyer() {
    return { reussi: this.reussi };
  }
}

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
});

describe("envoyerNotificationAbonne (4.4, 8.3, 8.4)", () => {
  it("envoie un SMS et un e-mail quand l'abonné a les deux coordonnées, et journalise chaque envoi", () => {
    const abonne = db
      .insert(schema.abonne)
      .values({ siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000", email: "valentin@example.cm" })
      .returning()
      .get();
    const fournisseur = new FournisseurFactice();

    const resultats = envoyerNotificationAbonne(db, fournisseur, {
      idAbonne: abonne.idAbonne,
      evenement: "ALERTE_ECHEANCE",
      message: "Votre abonnement arrive à échéance.",
    });

    expect(resultats).toHaveLength(2);
    const journal = db.select().from(schema.notification).where(eq(schema.notification.idAbonne, abonne.idAbonne)).all();
    expect(journal).toHaveLength(2);
    expect(journal.map((n) => n.canal).sort()).toEqual(["EMAIL", "SMS"]);
    expect(journal.every((n) => n.statutEnvoi === "ENVOYEE")).toBe(true);
    expect(journal.find((n) => n.canal === "SMS")?.destinataire).toBe("690000000");
    expect(journal.find((n) => n.canal === "EMAIL")?.destinataire).toBe("valentin@example.cm");
  });

  it("n'envoie que par SMS quand l'abonné n'a pas d'e-mail (canal de contact existant)", () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Alice", telephone: "690000001" }).returning().get();
    const fournisseur = new FournisseurFactice();

    const resultats = envoyerNotificationAbonne(db, fournisseur, { idAbonne: abonne.idAbonne, evenement: "SAV_PRET", message: "Votre appareil est prêt." });

    expect(resultats).toHaveLength(1);
    expect(resultats[0].canal).toBe("SMS");
  });

  it("journalise ECHOUEE quand le fournisseur échoue, sans lever d'exception", () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Alice", telephone: "690000001" }).returning().get();
    const fournisseur = new FournisseurFactice();
    fournisseur.reussi = false;

    const resultats = envoyerNotificationAbonne(db, fournisseur, { idAbonne: abonne.idAbonne, evenement: "SAV_PRET", message: "Votre appareil est prêt." });

    expect(resultats[0].statutEnvoi).toBe("ECHOUEE");
  });

  it("rattache la notification à l'alerte ou au dossier SAV d'origine quand fourni", () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Alice", telephone: "690000001" }).returning().get();
    const dossier = db
      .insert(schema.savDossier)
      .values({ siteId, idAbonne: abonne.idAbonne, descriptionPanne: "Ne s'allume plus" })
      .returning()
      .get();
    const fournisseur = new FournisseurFactice();

    const resultats = envoyerNotificationAbonne(db, fournisseur, {
      idAbonne: abonne.idAbonne,
      evenement: "SAV_PRET",
      message: "Votre appareil est prêt.",
      idDossierSav: dossier.idDossierSav,
    });

    expect(resultats[0].idDossierSav).toBe(dossier.idDossierSav);
    expect(resultats[0].idAlerte).toBeNull();
  });

  it("ne journalise rien et renvoie un tableau vide quand l'abonné n'a aucune coordonnée exploitable", () => {
    // téléphone obligatoire au niveau schéma (4.5) : simulate absence via chaîne vide, jamais réellement nulle en pratique
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Alice", telephone: "" }).returning().get();
    const fournisseur = new FournisseurFactice();

    const resultats = envoyerNotificationAbonne(db, fournisseur, { idAbonne: abonne.idAbonne, evenement: "SAV_PRET", message: "Votre appareil est prêt." });

    expect(resultats).toEqual([]);
  });

  it("rejette un abonné inconnu", () => {
    const fournisseur = new FournisseurFactice();
    expect(() => envoyerNotificationAbonne(db, fournisseur, { idAbonne: 999999, evenement: "SAV_PRET", message: "x" })).toThrow(/introuvable/);
  });
});

describe("listerNotificationsAbonne (8.3)", () => {
  it("liste les notifications d'un abonné, les plus récentes en premier", () => {
    const abonne = db
      .insert(schema.abonne)
      .values({ siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000", email: "v@example.cm" })
      .returning()
      .get();
    const fournisseur = new FournisseurFactice();
    envoyerNotificationAbonne(db, fournisseur, { idAbonne: abonne.idAbonne, evenement: "ALERTE_ECHEANCE", message: "premier" });
    envoyerNotificationAbonne(db, fournisseur, { idAbonne: abonne.idAbonne, evenement: "SAV_PRET", message: "second" });

    const liste = listerNotificationsAbonne(db, abonne.idAbonne);
    expect(liste).toHaveLength(4); // 2 événements x (SMS + EMAIL)
    expect(liste[0].message).toBe("second");
  });
});
