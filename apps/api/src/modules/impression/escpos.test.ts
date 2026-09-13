import { describe, it, expect } from "vitest";
import { construireTicketEscPos } from "./escpos.js";

const TICKET_BASE = {
  entreprise: { nom: "Boutique Demo", devise: "XAF", mentionsLegales: null as string | null },
  site: { nom: "Site principal", adresse: "Akwa, Douala" as string | null },
  operation: "Vente",
  numeroAbonnement: null as number | null,
  lignes: [{ libelle: "Installation à domicile", montant: 5000 }],
  total: 5000,
  montantTaxe: 0,
  modePaiement: "CASH" as const,
  montantEncaisse: 5000,
  dateHeure: "2026-09-13T12:00:00.000Z",
};

// 11.4, 6.7 : "Compatibilité imprimante thermique 80mm (protocole ESC/POS)
// pour les tickets de caisse" — commandes binaires ESC/POS, pas du HTML
describe("construireTicketEscPos (11.4, 6.7)", () => {
  it("commence par la commande d'initialisation ESC @", () => {
    const buffer = construireTicketEscPos(TICKET_BASE);
    expect(buffer[0]).toBe(0x1b);
    expect(buffer[1]).toBe(0x40);
  });

  it("se termine par la commande de coupe papier GS V", () => {
    const buffer = construireTicketEscPos(TICKET_BASE);
    const fin = buffer.subarray(buffer.length - 3);
    expect(Array.from(fin)).toEqual([0x1d, 0x56, 0x00]);
  });

  it("contient le nom de l'entreprise, du site et des lignes en texte lisible", () => {
    const buffer = construireTicketEscPos(TICKET_BASE);
    const texte = buffer.toString("utf8");
    expect(texte).toContain("Boutique Demo");
    expect(texte).toContain("Site principal");
    expect(texte).toContain("Akwa, Douala");
    expect(texte).toContain("Installation à domicile");
    expect(texte).toContain(new Intl.NumberFormat("fr-FR").format(5000));
  });

  it("mentionne le numéro d'abonnement quand l'opération en porte un", () => {
    const buffer = construireTicketEscPos({ ...TICKET_BASE, operation: "Recrutement", numeroAbonnement: 42 });
    expect(buffer.toString("utf8")).toContain("42");
  });

  it("affiche les mentions légales, ou un message par défaut si absentes", () => {
    const avecMentions = construireTicketEscPos({ ...TICKET_BASE, entreprise: { ...TICKET_BASE.entreprise, mentionsLegales: "RC/DLA/2024/B/1234" } });
    expect(avecMentions.toString("utf8")).toContain("RC/DLA/2024/B/1234");

    const sansMentions = construireTicketEscPos(TICKET_BASE);
    expect(sansMentions.toString("utf8")).toContain("Merci de votre confiance");
  });
});
