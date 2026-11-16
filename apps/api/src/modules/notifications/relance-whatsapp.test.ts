import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import { buildApp } from "../../app.js";
import { creerUtilisateur } from "../utilisateurs/utilisateur.repository.js";
import { enregistrerRelanceWhatsApp, listerNotificationsAbonne } from "./notification.service.js";
import { construireFiche360 } from "../abonnes/fiche-360.service.js";
import { anonymiserAbonne } from "../abonnes/anonymisation.service.js";
import * as schema from "../../db/schema.js";

const JWT_SECRET_TEST = "secret-de-test-ne-jamais-utiliser-en-prod";
const MESSAGE = "Boutique Test : rappel — votre abonnement CANAL+ EVASION n°1 arrive à échéance dans 3 jours (30/10/2026). Réabonnez-vous dès maintenant.";

let db: Db;
let siteId: number;
let autreSiteId: number;
let userId: number;
let idAbonne: number;
let numeroAbonnement: number;

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  autreSiteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site B" }).returning().get().idSite;
  userId = creerUtilisateur(db, { siteId, nom: "Nga", prenom: "Paul", identifiant: "caissier1", motDePasse: "motdepasse-secret", role: "CAISSIER" }).idUser;
  creerUtilisateur(db, { siteId, nom: "Mbia", prenom: "Luc", identifiant: "technicien1", motDePasse: "motdepasse-secret", role: "TECHNICIEN_SAV" });
  creerUtilisateur(db, { siteId: autreSiteId, nom: "Ndi", prenom: "Eve", identifiant: "caissier-b", motDePasse: "motdepasse-secret", role: "CAISSIER" });
  const famille = db.insert(schema.familleAbonnement).values({ libelle: "CANAL+" }).returning().get();
  const formule = db.insert(schema.formule).values({ idFamille: famille.idFamille, libelle: "EVASION", prix: 10500, rang: 2 }).returning().get();
  idAbonne = db.insert(schema.abonne).values({ siteId, nom: "Essomba", prenom: "Marie", telephone: "677 00 00 01" }).returning().get().idAbonne;
  numeroAbonnement = db
    .insert(schema.abonnement)
    .values({ idAbonne, idFormule: formule.idFormule, siteId, dateDebut: "2026-10-01", dateFin: "2026-10-30", statut: "ACTIF", creePar: userId })
    .returning()
    .get().numeroAbonnement;
});

const entetes = async (app: FastifyInstance, identifiant = "caissier1") => {
  const reponse = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { identifiant, motDePasse: "motdepasse-secret" } });
  return { authorization: `Bearer ${reponse.json().token as string}` };
};

describe("enregistrerRelanceWhatsApp : le clic est noté dans le journal du client", () => {
  it("crée une entrée WhatsApp « ouverte » : numéro du client, message, abonnement, auteur, sans jamais prétendre que le message est parti", () => {
    const n = enregistrerRelanceWhatsApp(db, { idAbonne, evenement: "ALERTE_ECHEANCE", message: MESSAGE, numeroAbonnement, userId });

    expect(n).toMatchObject({ idAbonne, canal: "WHATSAPP", evenement: "ALERTE_ECHEANCE", destinataire: "677 00 00 01", message: MESSAGE, statutEnvoi: "OUVERTE", numeroAbonnement, utilisateurId: userId });
    expect(n.dateEnvoi).toBeTruthy();
  });

  it("apparaît dans le journal et la fiche 360° du client, la plus récente d'abord, à côté des SMS", () => {
    db.insert(schema.notification).values({ idAbonne, canal: "SMS", evenement: "ALERTE_ECHEANCE", destinataire: "677 00 00 01", message: "SMS", statutEnvoi: "SIMULEE" }).run();
    enregistrerRelanceWhatsApp(db, { idAbonne, evenement: "ABONNEMENT_EXPIRE", message: "Expiré", numeroAbonnement, userId });

    expect(listerNotificationsAbonne(db, idAbonne).map((n) => n.canal)).toEqual(["WHATSAPP", "SMS"]);
    expect(construireFiche360(db, idAbonne)?.notifications[0]).toMatchObject({ canal: "WHATSAPP", evenement: "ABONNEMENT_EXPIRE" });
  });

  it("deux clics = deux entrées : on voit chaque relance et son heure", () => {
    enregistrerRelanceWhatsApp(db, { idAbonne, evenement: "ALERTE_ECHEANCE", message: MESSAGE, numeroAbonnement, userId });
    enregistrerRelanceWhatsApp(db, { idAbonne, evenement: "ALERTE_ECHEANCE", message: MESSAGE, numeroAbonnement, userId });

    expect(listerNotificationsAbonne(db, idAbonne)).toHaveLength(2);
  });

  it("refuse un abonné inconnu, ou anonymisé (plus de numéro à qui écrire)", () => {
    expect(() => enregistrerRelanceWhatsApp(db, { idAbonne: 999999, evenement: "ALERTE_ECHEANCE", message: MESSAGE, userId })).toThrow(/introuvable/i);

    anonymiserAbonne(db, { idAbonne, userId });
    expect(() => enregistrerRelanceWhatsApp(db, { idAbonne, evenement: "ALERTE_ECHEANCE", message: MESSAGE, userId })).toThrow(/anonymis/i);
  });

  it.each([
    [{ message: "" }, /message/i],
    [{ message: "   " }, /message/i],
    [{ message: "x".repeat(1001) }, /message/i],
    [{ message: 42 }, /message/i],
    [{ evenement: "SAV_PRET" }, /événement|evenement/i],
    [{ evenement: "n'importe quoi" }, /événement|evenement/i],
    [{ numeroAbonnement: 999999 }, /abonnement/i],
  ])("refuse %j sans rien enregistrer", (surcharge, message) => {
    expect(() => enregistrerRelanceWhatsApp(db, { idAbonne, evenement: "ALERTE_ECHEANCE", message: MESSAGE, numeroAbonnement, userId, ...(surcharge as object) } as never)).toThrow(message);

    expect(listerNotificationsAbonne(db, idAbonne)).toHaveLength(0);
  });

  it("refuse l'abonnement d'un autre client", () => {
    const autre = db.insert(schema.abonne).values({ siteId, nom: "Autre", prenom: "Paul", telephone: "677 00 00 02" }).returning().get();

    expect(() => enregistrerRelanceWhatsApp(db, { idAbonne: autre.idAbonne, evenement: "ALERTE_ECHEANCE", message: MESSAGE, numeroAbonnement, userId })).toThrow(/abonnement/i);
  });

  it("l'anonymisation efface aussi le numéro des entrées WhatsApp", () => {
    enregistrerRelanceWhatsApp(db, { idAbonne, evenement: "ALERTE_ECHEANCE", message: MESSAGE, numeroAbonnement, userId });

    anonymiserAbonne(db, { idAbonne, userId });

    const lignes = db.select().from(schema.notification).where(eq(schema.notification.idAbonne, idAbonne)).all();
    expect(lignes).toHaveLength(1);
    expect(lignes[0].destinataire).not.toContain("677");
  });
});

describe("POST /api/v1/abonnes/:idAbonne/relances-whatsapp", () => {
  const corps = () => ({ evenement: "ALERTE_ECHEANCE", message: MESSAGE, numeroAbonnement });

  it("un caissier note la relance (201) ; elle porte son nom", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({ method: "POST", url: `/api/v1/abonnes/${idAbonne}/relances-whatsapp`, headers: await entetes(app), payload: corps() });

    expect(reponse.statusCode).toBe(201);
    expect(reponse.json()).toMatchObject({ canal: "WHATSAPP", statutEnvoi: "OUVERTE", utilisateurId: userId });
    expect(listerNotificationsAbonne(db, idAbonne)).toHaveLength(1);
  });

  it("refuse (400) une saisie invalide, avec un message clair", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({ method: "POST", url: `/api/v1/abonnes/${idAbonne}/relances-whatsapp`, headers: await entetes(app), payload: { ...corps(), message: "" } });

    expect(reponse.statusCode).toBe(400);
    expect(reponse.json().erreur).toMatch(/message/i);
  });

  it("refuse le client d'un autre site (403), un rôle sans accès au tableau de bord (403), et l'absence de connexion (401)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const url = `/api/v1/abonnes/${idAbonne}/relances-whatsapp`;

    expect((await app.inject({ method: "POST", url, headers: await entetes(app, "caissier-b"), payload: corps() })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: await entetes(app, "technicien1"), payload: corps() })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, payload: corps() })).statusCode).toBe(401);
    expect(listerNotificationsAbonne(db, idAbonne)).toHaveLength(0);
  });

  it("un abonné inconnu : 404", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });

    const reponse = await app.inject({ method: "POST", url: "/api/v1/abonnes/999999/relances-whatsapp", headers: await entetes(app), payload: corps() });

    expect(reponse.statusCode).toBe(404);
  });
});

describe("tableau de bord : « déjà relancé »", () => {
  it("l'abonnement à échéance porte la date de sa dernière relance WhatsApp (null tant qu'il n'a pas été relancé)", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const headers = await entetes(app);
    // la date « d'aujourd'hui » du serveur : on place l'échéance dans 2 jours
    const dans2Jours = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    db.update(schema.abonnement).set({ dateFin: dans2Jours }).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).run();

    const avant = (await app.inject({ method: "GET", url: "/api/v1/alertes-echeance", headers })).json();
    expect(avant).toHaveLength(1);
    expect(avant[0].derniereRelanceWhatsApp).toBeNull();

    enregistrerRelanceWhatsApp(db, { idAbonne, evenement: "ALERTE_ECHEANCE", message: MESSAGE, numeroAbonnement, userId });

    const apres = (await app.inject({ method: "GET", url: "/api/v1/alertes-echeance", headers })).json();
    expect(apres[0].derniereRelanceWhatsApp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("l'abonnement expiré aussi", async () => {
    const app = buildApp(db, { jwtSecret: JWT_SECRET_TEST });
    const headers = await entetes(app);
    const hier = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    db.update(schema.abonnement).set({ dateFin: hier, statut: "EXPIRE" }).where(eq(schema.abonnement.numeroAbonnement, numeroAbonnement)).run();

    expect((await app.inject({ method: "GET", url: "/api/v1/abonnements-expires", headers })).json()[0].derniereRelanceWhatsApp).toBeNull();

    enregistrerRelanceWhatsApp(db, { idAbonne, evenement: "ABONNEMENT_EXPIRE", message: "Expiré", numeroAbonnement, userId });

    expect((await app.inject({ method: "GET", url: "/api/v1/abonnements-expires", headers })).json()[0].derniereRelanceWhatsApp).not.toBeNull();
  });
});

describe("journal du client : qui a relancé", () => {
  it("la fiche 360° donne le nom de la personne qui a ouvert la relance, et rien pour un SMS automatique", () => {
    db.insert(schema.notification).values({ idAbonne, canal: "SMS", evenement: "ALERTE_ECHEANCE", destinataire: "677 00 00 01", message: "SMS", statutEnvoi: "SIMULEE" }).run();
    enregistrerRelanceWhatsApp(db, { idAbonne, evenement: "ALERTE_ECHEANCE", message: MESSAGE, numeroAbonnement, userId });

    const [whatsapp, sms] = construireFiche360(db, idAbonne)!.notifications;

    expect(whatsapp.auteur).toBe("Paul Nga");
    expect(sms.auteur).toBeNull();
  });
});
