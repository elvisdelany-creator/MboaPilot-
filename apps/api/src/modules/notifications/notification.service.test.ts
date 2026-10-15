import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { envoyerNotificationAbonne, envoyerNotificationClientPonctuel, listerNotificationsAbonne } from "./notification.service.js";
import { anonymiserAbonne } from "../abonnes/anonymisation.service.js";
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

  // 11.3 : le téléphone d'un abonné anonymisé est un repère factice, jamais
  // un vrai canal de contact — le droit à l'effacement perdrait tout son
  // sens si le job quotidien continuait de "joindre" le client via ce repère
  it("ne tente aucun envoi SMS au repère de téléphone laissé par une anonymisation (11.3)", () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Ngo", prenom: "Alice", telephone: "690000001" }).returning().get();
    anonymiserAbonne(db, { idAbonne: abonne.idAbonne });
    const fournisseur = new FournisseurFactice();

    const resultats = envoyerNotificationAbonne(db, fournisseur, { idAbonne: abonne.idAbonne, evenement: "ALERTE_ECHEANCE", message: "Votre abonnement arrive à échéance." });

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

// Le service promet « jamais d'exception pour un problème d'acheminement » mais ne gérait que
// { reussi: false } : une passerelle SMS réelle qui lève une exception (réseau coupé, délai dépassé)
// remontait au job quotidien APRÈS l'enregistrement de l'alerte, et le SMS n'était jamais renvoyé
// (l'alerte du jour est déjà notée comme envoyée).
describe("notifications : fournisseur qui lève une exception", () => {
  const enPanne: FournisseurNotification = {
    envoyer() {
      throw new Error("connect ETIMEDOUT passerelle-sms");
    },
  };

  it("journalise l'envoi comme ECHOUEE au lieu de lever l'exception, pour chaque canal", () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Nga", prenom: "Paul", telephone: "690000000", email: "paul@example.cm" }).returning().get();

    const resultats = envoyerNotificationAbonne(db, enPanne, { idAbonne: abonne.idAbonne, evenement: "ALERTE_ECHEANCE", message: "Échéance proche." });

    expect(resultats.map((n) => [n.canal, n.statutEnvoi])).toEqual([["SMS", "ECHOUEE"], ["EMAIL", "ECHOUEE"]]);
  });

  it("continue avec le canal suivant quand le premier échoue par exception", () => {
    const abonne = db.insert(schema.abonne).values({ siteId, nom: "Nga", prenom: "Paul", telephone: "690000000", email: "paul@example.cm" }).returning().get();
    const smsEnPanne: FournisseurNotification = {
      envoyer(canal) {
        if (canal === "SMS") throw new Error("passerelle SMS injoignable");
        return { reussi: true };
      },
    };

    const resultats = envoyerNotificationAbonne(db, smsEnPanne, { idAbonne: abonne.idAbonne, evenement: "ALERTE_ECHEANCE", message: "Échéance proche." });

    expect(resultats.map((n) => [n.canal, n.statutEnvoi])).toEqual([["SMS", "ECHOUEE"], ["EMAIL", "ENVOYEE"]]);
  });

  it("journalise aussi comme ECHOUEE l'envoi à un client ponctuel (SAV prêt)", () => {
    const dossier = db.insert(schema.savDossier).values({ siteId, descriptionPanne: "Ne s'allume plus" }).returning().get();

    const resultat = envoyerNotificationClientPonctuel(db, enPanne, { telephone: "690000000", evenement: "SAV_PRET", message: "Appareil prêt.", idDossierSav: dossier.idDossierSav });

    expect(resultat.statutEnvoi).toBe("ECHOUEE");
  });
});
