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
    // le ticket est encodé en Windows-1252 (page de codes de l'imprimante), pas en UTF-8
    const texte = buffer.toString("latin1");
    expect(texte).toContain("Boutique Demo");
    expect(texte).toContain("Site principal");
    expect(texte).toContain("Akwa, Douala");
    expect(texte).toContain("Installation à domicile");
    expect(texte).toContain(new Intl.NumberFormat("fr-FR").format(5000).replace(/\s/g, " "));
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

// Constaté en test grandeur nature (faux port d'imprimante qui capture les octets) : le ticket partait
// en UTF-8 sans choix de page de codes — « Câble » en 43 c3 a2…, que les imprimantes thermiques
// affichent en caractères parasites —, l'espace fine insécable de « 2 500 » n'existait pas dans
// la page de l'imprimante, et un libellé pouvait embarquer ESC p (ouverture du tiroir-caisse) ou
// GS V (coupe du papier).
describe("construireTicketEscPos : encodage et commandes parasites", () => {
  const avecLibelle = (libelle: string) => construireTicketEscPos({ ...TICKET_BASE, lignes: [{ libelle, montant: 100 }] });
  const compter = (buffer: Buffer, motif: number[]) => buffer.toString("hex").split(Buffer.from(motif).toString("hex")).length - 1;

  it("sélectionne la page de codes Windows-1252 (ESC t 16) juste après l'initialisation", () => {
    const buffer = construireTicketEscPos(TICKET_BASE);

    expect(Array.from(buffer.subarray(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 16]);
  });

  it("encode les accents français sur un octet, pas en UTF-8", () => {
    const buffer = avecLibelle("Câble é à ç ô œ « » € — ’");

    expect(buffer.includes(Buffer.from([0x43, 0xe2, 0x62, 0x6c, 0x65]))).toBe(true); // Câble
    for (const octet of [0xe9, 0xe0, 0xe7, 0xf4, 0x9c, 0xab, 0xbb, 0x80, 0x97, 0x92]) {
      expect(buffer.includes(Buffer.from([octet])), octet.toString(16)).toBe(true);
    }
    expect(buffer.includes(Buffer.from([0xc3]))).toBe(false); // plus aucun préfixe UTF-8
  });

  it("remplace par « ? » un caractère absent de la page de codes", () => {
    expect(avecLibelle("漢字 😀").toString("latin1")).toContain("?? ?");
  });

  it("écrit les espaces insécables des montants comme des espaces simples", () => {
    const buffer = construireTicketEscPos({ ...TICKET_BASE, total: 2500, montantEncaisse: 2500 });

    expect(buffer.toString("latin1")).toContain("2 500");
    expect(buffer.includes(Buffer.from([0xe2, 0x80, 0xaf]))).toBe(false);
  });

  it("neutralise les caractères de contrôle d'un libellé : pas d'ouverture de tiroir (ESC p), ni de coupe (GS V) en plus", () => {
    const piege = avecLibelle("Piège\x1bp\x00\x19\xfa\x1dV\x00 fin");

    expect(compter(piege, [0x1b, 0x70])).toBe(0);
    expect(compter(piege, [0x1d, 0x56])).toBe(1); // celle, voulue, de fin de ticket
    expect(piege.toString("latin1")).toContain("Pi\xe8ge p");
  });

  it("n'accepte pas de saut de ligne dans un libellé (il décalerait la mise en page)", () => {
    expect(avecLibelle("Ligne A\nLigne B").toString("latin1")).toContain("Ligne A Ligne B");
  });
});
