import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { SimulateurImpression } from "./simulateur-impression.js";
import { imprimerTicket } from "./impression.service.js";

let db: Db;
let siteId: number;

const TICKET_BASE = {
  operation: "Vente",
  numeroAbonnement: null as number | null,
  lignes: [{ libelle: "Installation à domicile", montant: 5000 }],
  total: 5000,
  montantTaxe: 0,
  modePaiement: "CASH" as const,
  montantEncaisse: 5000,
  dateHeure: "2026-09-13T12:00:00.000Z",
};
// complété à chaque test avec une facture VALIDEE du site (6.4 : seul un ticket de facture validée s'imprime)
let TICKET = { ...TICKET_BASE, idFacture: 0 };

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
  const idUser = db.insert(schema.utilisateur).values({ siteId, nom: "A", prenom: "B", identifiant: "ab", motDePasseHash: "h", role: "CAISSIER" }).returning().get().idUser;
  const idFacture = db.insert(schema.facture).values({ siteId, statut: "VALIDEE", montantTotal: 5000, creePar: idUser }).returning().get().idFacture;
  TICKET = { ...TICKET_BASE, idFacture };
});

// 11.4, 6.7 : n'imprime réellement (ESC/POS réseau) que si une imprimante a
// été configurée pour le site — sinon le caissier reste sur l'impression
// navigateur déjà existante (repli, jamais un blocage).
describe("imprimerTicket (11.4)", () => {
  it("n'envoie rien et renvoie imprime:false si aucune imprimante n'est configurée pour le site", async () => {
    const fournisseur = new SimulateurImpression();

    const resultat = await imprimerTicket(db, fournisseur, { siteId, ticket: TICKET });

    expect(resultat).toEqual({ imprime: false });
    expect(fournisseur.envois).toHaveLength(0);
  });

  it("envoie le ticket ESC/POS à l'imprimante configurée pour le site et renvoie imprime:true", async () => {
    db.update(schema.site).set({ imprimanteHote: "192.168.1.50", imprimantePort: 9100 }).where(eq(schema.site.idSite, siteId)).run();
    const fournisseur = new SimulateurImpression();

    const resultat = await imprimerTicket(db, fournisseur, { siteId, ticket: TICKET });

    expect(resultat).toEqual({ imprime: true });
    expect(fournisseur.envois).toHaveLength(1);
    expect(fournisseur.envois[0].hote).toBe("192.168.1.50");
    expect(fournisseur.envois[0].port).toBe(9100);
    expect(fournisseur.envois[0].donnees.toString("utf8")).toContain("Boutique Test");
  });

  it("utilise le port 9100 par défaut si seul l'hôte est configuré", async () => {
    db.update(schema.site).set({ imprimanteHote: "192.168.1.50" }).where(eq(schema.site.idSite, siteId)).run();
    const fournisseur = new SimulateurImpression();

    const resultat = await imprimerTicket(db, fournisseur, { siteId, ticket: TICKET });

    expect(resultat).toEqual({ imprime: true });
    expect(fournisseur.envois[0].port).toBe(9100);
  });

  it("renvoie imprime:false pour un site inconnu, sans lever d'erreur", async () => {
    const fournisseur = new SimulateurImpression();

    const resultat = await imprimerTicket(db, fournisseur, { siteId: 999999, ticket: TICKET });

    expect(resultat).toEqual({ imprime: false });
  });
});

// Constaté en test grandeur nature : le contenu du ticket venait du client sans contrôle — une date
// illisible donnait « Invalid time value », un libellé de 100 000 caractères imprimait 100 Ko de
// papier et un total « abc » était imprimé tel quel.
describe("imprimerTicket : contenu du ticket (11.4)", () => {
  beforeEach(() => {
    db.update(schema.site).set({ imprimanteHote: "192.168.1.50", imprimantePort: 9100 }).where(eq(schema.site.idSite, siteId)).run();
  });

  it.each([
    ["une date illisible", { dateHeure: "pas une date" }, /date.*invalide/i],
    ["une liste de lignes absente", { lignes: undefined }, /lignes/i],
    ["plus de 100 lignes", { lignes: Array.from({ length: 101 }, () => ({ libelle: "Article", montant: 1 })) }, /100 lignes/i],
    ["un libellé qui n'est pas un texte", { lignes: [{ libelle: 123, montant: 1 }] }, /libellé/i],
    ["un libellé de plus de 200 caractères", { lignes: [{ libelle: "L".repeat(201), montant: 1 }] }, /libellé.*200 caractères/i],
    ["un montant de ligne décimal", { lignes: [{ libelle: "Article", montant: 1.5 }] }, /entier/i],
    ["un total qui n'est pas un nombre", { total: "abc" }, /total.*entier/i],
    ["un montant encaissé hors limites", { montantEncaisse: 9007199254740991 }, /encaissé/i],
    ["un mode de paiement inconnu", { modePaiement: "TROC" }, /mode de paiement/i],
    ["une opération vide", { operation: "  " }, /opération/i],
  ])("refuse %s, sans rien envoyer à l'imprimante", async (_libelle, surcharge, message) => {
    const fournisseur = new SimulateurImpression();

    await expect(imprimerTicket(db, fournisseur, { siteId, ticket: { ...TICKET, ...surcharge } as never })).rejects.toThrow(message);
    expect(fournisseur.envois).toHaveLength(0);
  });

  it("accepte un ticket d'avoir (montants négatifs) et jusqu'à 100 lignes", async () => {
    const fournisseur = new SimulateurImpression();
    const lignes = Array.from({ length: 100 }, () => ({ libelle: "Article", montant: -500 }));

    const resultat = await imprimerTicket(db, fournisseur, { siteId, ticket: { ...TICKET, lignes, total: -50000, montantEncaisse: 0 } });

    expect(resultat).toEqual({ imprime: true });
  });

  it("ne valide rien quand aucune imprimante n'est configurée : le caissier reste sur l'impression navigateur", async () => {
    db.update(schema.site).set({ imprimanteHote: null }).where(eq(schema.site.idSite, siteId)).run();

    const resultat = await imprimerTicket(db, new SimulateurImpression(), { siteId, ticket: { ...TICKET, total: "abc" } as never });

    expect(resultat).toEqual({ imprime: false });
  });
});

// 6.4 (règle 2) : « une facture BROUILLON ne peut jamais être imprimée ni transmise au client — c'est une
// contrainte système, pas seulement une convention d'usage ». Le ticket était du contenu libre, sans lien avec
// une facture : rien côté serveur n'empêchait d'imprimer une vente non encaissée.
describe("imprimerTicket : seules les factures validées s'impriment (6.4)", () => {
  const facture = (statut: "BROUILLON" | "VALIDEE", site = siteId) =>
    db.insert(schema.facture).values({ siteId: site, statut, montantTotal: 5000, creePar: db.select().from(schema.utilisateur).get()!.idUser }).returning().get().idFacture;

  beforeEach(() => {
    db.update(schema.site).set({ imprimanteHote: "192.168.1.50" }).where(eq(schema.site.idSite, siteId)).run();
  });

  it("imprime le ticket d'une facture VALIDEE", async () => {
    const fournisseur = new SimulateurImpression();
    const resultat = await imprimerTicket(db, fournisseur, { siteId, ticket: { ...TICKET, idFacture: facture("VALIDEE") } as never });
    expect(resultat).toEqual({ imprime: true });
  });

  it("refuse le ticket d'une facture BROUILLON, sans rien envoyer à l'imprimante", async () => {
    const fournisseur = new SimulateurImpression();
    await expect(imprimerTicket(db, fournisseur, { siteId, ticket: { ...TICKET, idFacture: facture("BROUILLON") } as never })).rejects.toThrow(/brouillon/i);
    expect(fournisseur.envois).toHaveLength(0);
  });

  it("refuse un ticket sans numéro de facture", async () => {
    const fournisseur = new SimulateurImpression();
    await expect(imprimerTicket(db, fournisseur, { siteId, ticket: { ...TICKET, idFacture: undefined } as never })).rejects.toThrow(/facture/i);
    expect(fournisseur.envois).toHaveLength(0);
  });

  it("refuse une facture inexistante ou d'un autre site", async () => {
    const autreSite = db.insert(schema.site).values({ idEntreprise: db.select().from(schema.entreprise).get()!.idEntreprise, nom: "Site B" }).returning().get().idSite;
    const fournisseur = new SimulateurImpression();
    await expect(imprimerTicket(db, fournisseur, { siteId, ticket: { ...TICKET, idFacture: 999999 } as never })).rejects.toThrow(/introuvable/i);
    await expect(imprimerTicket(db, fournisseur, { siteId, ticket: { ...TICKET, idFacture: facture("VALIDEE", autreSite) } as never })).rejects.toThrow(/introuvable/i);
    expect(fournisseur.envois).toHaveLength(0);
  });
});
