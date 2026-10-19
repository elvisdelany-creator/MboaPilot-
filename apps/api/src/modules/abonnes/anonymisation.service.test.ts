import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerAbonne, trouverAbonne } from "./abonne.repository.js";
import { recruterAbonne } from "../abonnements/recrutement.service.js";
import { anonymiserAbonne } from "./anonymisation.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let userId: number;
let idFormule: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" })
    .returning()
    .get().idUser;
  const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  idFormule = db.insert(schema.formule).values({ idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
});

// 11.3 : droit de suppression — outil technique, la conformité précise
// (durée de conservation, base légale) reste à valider juridiquement (11.3).
describe("anonymiserAbonne (11.3)", () => {
  it("efface l'identité et les coordonnées, sans supprimer la fiche ni son historique transactionnel", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000", email: "v@example.cm", numeroCni: "CM123", adresse: "Douala" });
    const { numeroAbonnement, idFacture } = recruterAbonne(db, { siteId, userId, aujourdHui: "2025-11-16", abonne: { idAbonne: abonne.idAbonne }, idFormule, montantEncaisse: 10500 });

    const resultat = anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });

    expect(resultat.nom).not.toBe("Nga Ndongo");
    expect(resultat.prenom).not.toBe("Valentin");
    expect(resultat.telephone).not.toBe("690000000");
    expect(resultat.email).toBeNull();
    expect(resultat.numeroCni).toBeNull();
    expect(resultat.adresse).toBeNull();
    expect(resultat.idAbonne).toBe(abonne.idAbonne);

    // la fiche et son historique transactionnel restent intacts (obligations comptables, 11.3)
    expect(trouverAbonne(db, abonne.idAbonne)).toBeDefined();
    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get();
    expect(abonnement?.idAbonne).toBe(abonne.idAbonne);
    const facture = db.select().from(schema.facture).where(eq(schema.facture.idFacture, idFacture)).get();
    expect(facture?.idAbonne).toBe(abonne.idAbonne);
  });

  // 11.3 : le journal d'audit trace QUE l'action a eu lieu, jamais les
  // données personnelles effacées elles-mêmes — sans quoi le droit de
  // suppression serait vidé de son sens (la fiche personnelle survivrait en
  // clair, indéfiniment, dans une autre table consultable par l'encadrement).
  it("journalise l'anonymisation sans jamais y conserver les données personnelles effacées", () => {
    const abonne = creerAbonne(db, {
      siteId,
      nom: "Nga Ndongo",
      prenom: "Valentin",
      telephone: "690000000",
      email: "v@example.cm",
      numeroCni: "CM123",
      adresse: "Douala",
    });

    anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });

    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "abonne")).all();
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("SUPPRESSION");
    expect(audit[0].idCible).toBe(String(abonne.idAbonne));
    expect(audit[0].utilisateurId).toBe(userId);
    expect(audit[0].valeurAvant).not.toContain("Nga Ndongo");
    expect(audit[0].valeurAvant).not.toContain("Valentin");
    expect(audit[0].valeurAvant).not.toContain("690000000");
    expect(audit[0].valeurAvant).not.toContain("v@example.cm");
    expect(audit[0].valeurAvant).not.toContain("CM123");
    expect(audit[0].valeurAvant).not.toContain("Douala");
    expect(JSON.parse(audit[0].valeurAvant!).champsEffaces).toEqual(
      expect.arrayContaining(["nom", "prenom", "telephone", "email", "numeroCni", "adresse"])
    );
  });

  it("rejette un abonné inconnu", () => {
    expect(() => anonymiserAbonne(db, { idAbonne: 999999, userId })).toThrow(/introuvable/);
  });

  it("est idempotent — anonymiser une fiche déjà anonymisée ne renvoie pas d'erreur", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });

    anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });
    const deuxiemeAppel = anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });

    expect(deuxiemeAppel.email).toBeNull();
  });

  // 11.3 : anonymisation automatique déclenchée par le job quotidien —
  // aucun utilisateur humain à l'origine de l'action
  it("sans userId (job automatique), journalise avec utilisateur_id NULL", () => {
    const abonne = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });

    anonymiserAbonne(db, { idAbonne: abonne.idAbonne });

    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "abonne")).all();
    expect(audit).toHaveLength(1);
    expect(audit[0].utilisateurId).toBeNull();
  });
});

// 11.3 : le droit à l'effacement vide aussi les copies de l'identité tenues ailleurs que sur la fiche. Le journal des
// notifications gardait le téléphone et l'e-mail en clair (colonne destinataire), et un dossier SAV rattaché
// pouvait porter le nom et le téléphone saisis à l'ouverture.
describe("anonymiserAbonne : copies de l'identité hors de la fiche (11.3)", () => {
  function abonneAvecTraces() {
    const abonne = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000", email: "v@example.cm" });
    db.insert(schema.notification).values([
      { idAbonne: abonne.idAbonne, canal: "SMS", evenement: "ALERTE_ECHEANCE", destinataire: "690000000", message: "Votre abonnement arrive à échéance.", statutEnvoi: "SIMULEE" },
      { idAbonne: abonne.idAbonne, canal: "EMAIL", evenement: "ALERTE_ECHEANCE", destinataire: "v@example.cm", message: "Votre abonnement arrive à échéance.", statutEnvoi: "SIMULEE" },
    ]).run();
    const dossier = db.insert(schema.savDossier).values({ siteId, idAbonne: abonne.idAbonne, clientNom: "Nga Ndongo Valentin", clientTelephone: "690000000", descriptionPanne: "Ne s'allume plus", sousGarantie: 0 }).returning().get();
    return { abonne, dossier };
  }

  it("remplace les destinataires des notifications de l'abonné, sans supprimer le journal", () => {
    const { abonne } = abonneAvecTraces();

    anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });

    const notifications = db.select().from(schema.notification).where(eq(schema.notification.idAbonne, abonne.idAbonne)).all();
    expect(notifications).toHaveLength(2);
    for (const n of notifications) {
      expect(n.destinataire).not.toContain("690000000");
      expect(n.destinataire).not.toContain("v@example.cm");
    }
  });

  it("efface le nom et le téléphone copiés sur les dossiers SAV de l'abonné, en gardant le dossier", () => {
    const { abonne, dossier } = abonneAvecTraces();

    anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });

    const apres = db.select().from(schema.savDossier).where(eq(schema.savDossier.idDossierSav, dossier.idDossierSav)).get();
    expect(apres?.descriptionPanne).toBe("Ne s'allume plus");
    expect(apres?.clientNom).toBeNull();
    expect(apres?.clientTelephone).toBeNull();
  });

  it("ne touche pas aux notifications ni aux dossiers des autres clients", () => {
    const { abonne } = abonneAvecTraces();
    const autre = creerAbonne(db, { siteId, nom: "Autre", prenom: "Client", telephone: "699999999" });
    db.insert(schema.notification).values({ idAbonne: autre.idAbonne, canal: "SMS", evenement: "ALERTE_ECHEANCE", destinataire: "699999999", message: "x", statutEnvoi: "SIMULEE" }).run();

    anonymiserAbonne(db, { idAbonne: abonne.idAbonne, userId });

    expect(db.select().from(schema.notification).where(eq(schema.notification.idAbonne, autre.idAbonne)).get()?.destinataire).toBe("699999999");
  });
});

