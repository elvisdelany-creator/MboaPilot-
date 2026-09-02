import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { creerAbonne, trouverAbonne } from "./abonne.repository.js";
import { recruterAbonne } from "../abonnements/recrutement.service.js";
import { creerDossierSav } from "../sav/sav.repository.js";
import { fusionnerAbonnes } from "./fusion-abonnes.service.js";
import * as schema from "../../db/schema.js";

let db: Db;
let siteId: number;
let autreSiteId: number;
let userId: number;
let idFormule: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  userId = db
    .insert(schema.utilisateur)
    .values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "ADMINISTRATEUR" })
    .returning()
    .get().idUser;
  const fam = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  idFormule = db.insert(schema.formule).values({ idFamille: fam.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get().idFormule;
});

describe("fusionnerAbonnes (8.1 : fusion de doublons, conservation de l'historique)", () => {
  it("rattache abonnements, factures et dossiers SAV du doublon à la fiche principale, puis supprime le doublon", () => {
    const principal = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });
    const doublon = creerAbonne(db, { siteId, nom: "Nga N.", prenom: "Val", telephone: "690000001" });

    const { numeroAbonnement } = recruterAbonne(db, { siteId, userId, aujourdHui: "2025-11-16", abonne: { idAbonne: doublon.idAbonne }, idFormule, montantEncaisse: 10500 });
    const dossier = creerDossierSav(db, { siteId, idAbonne: doublon.idAbonne, descriptionPanne: "Panne", sousGarantie: false, userId });

    fusionnerAbonnes(db, { idAbonnePrincipal: principal.idAbonne, idAbonneDoublon: doublon.idAbonne, userId });

    const abonnement = db.select().from(schema.abonnement).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).get();
    expect(abonnement?.idAbonne).toBe(principal.idAbonne);

    const dossierApres = db.select().from(schema.savDossier).where(eq(schema.savDossier.idDossierSav, dossier.idDossierSav)).get();
    expect(dossierApres?.idAbonne).toBe(principal.idAbonne);

    const factures = db.select().from(schema.facture).where(eq(schema.facture.idAbonne, principal.idAbonne)).all();
    expect(factures).toHaveLength(1);

    expect(trouverAbonne(db, doublon.idAbonne)).toBeUndefined();
  });

  it("journalise la fusion dans le journal d'audit (immuable)", () => {
    const principal = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });
    const doublon = creerAbonne(db, { siteId, nom: "Nga N.", prenom: "Val", telephone: "690000001" });

    fusionnerAbonnes(db, { idAbonnePrincipal: principal.idAbonne, idAbonneDoublon: doublon.idAbonne, userId });

    const audit = db.select().from(schema.journalAudit).where(eq(schema.journalAudit.tableCible, "abonne")).all();
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("SUPPRESSION");
    expect(audit[0].idCible).toBe(String(doublon.idAbonne));
    expect(audit[0].utilisateurId).toBe(userId);
  });

  it("rejette la fusion d'un abonné avec lui-même", () => {
    const ab = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });
    expect(() => fusionnerAbonnes(db, { idAbonnePrincipal: ab.idAbonne, idAbonneDoublon: ab.idAbonne, userId })).toThrow(/lui-même/);
  });

  it("rejette la fusion de deux fiches de sites différents", () => {
    const principal = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });
    const doublon = creerAbonne(db, { siteId: autreSiteId, nom: "Nga N.", prenom: "Val", telephone: "690000001" });

    expect(() => fusionnerAbonnes(db, { idAbonnePrincipal: principal.idAbonne, idAbonneDoublon: doublon.idAbonne, userId })).toThrow(/site/);
  });

  it("rejette un abonné principal ou doublon inconnu", () => {
    const ab = creerAbonne(db, { siteId, nom: "Nga Ndongo", prenom: "Valentin", telephone: "690000000" });
    expect(() => fusionnerAbonnes(db, { idAbonnePrincipal: 999999, idAbonneDoublon: ab.idAbonne, userId })).toThrow(/introuvable/);
    expect(() => fusionnerAbonnes(db, { idAbonnePrincipal: ab.idAbonne, idAbonneDoublon: 999999, userId })).toThrow(/introuvable/);
  });
});
