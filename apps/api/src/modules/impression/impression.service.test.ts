import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { creerDbTest, type Db } from "../../test-utils/db.js";
import * as schema from "../../db/schema.js";
import { SimulateurImpression } from "./simulateur-impression.js";
import { imprimerTicket } from "./impression.service.js";

let db: Db;
let siteId: number;

const TICKET = {
  operation: "Vente",
  numeroAbonnement: null as number | null,
  lignes: [{ libelle: "Installation à domicile", montant: 5000 }],
  total: 5000,
  montantTaxe: 0,
  modePaiement: "CASH" as const,
  montantEncaisse: 5000,
  dateHeure: "2026-09-13T12:00:00.000Z",
};

beforeEach(() => {
  db = creerDbTest();
  const ent = db.insert(schema.entreprise).values({ nom: "Boutique Test" }).returning().get();
  siteId = db.insert(schema.site).values({ idEntreprise: ent.idEntreprise, nom: "Site A" }).returning().get().idSite;
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
