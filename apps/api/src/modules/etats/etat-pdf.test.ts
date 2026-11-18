import { describe, it, expect } from "vitest";
import type { EtatImprimable } from "@mboapilot/shared";
import { cederLaMain } from "../../lib/ceder-la-main.js";
import { rendreEtatPdf, texteCompatiblePdf } from "./etat-pdf.js";

// pdfkit écrit le texte en hexadécimal dans des opérateurs Tj / TJ, en octets Windows-1252 : on le relit pour vérifier ce qui est réellement dessiné
function textesDuPdf(pdf: Buffer): string[] {
  const decodeur = new TextDecoder("windows-1252");
  const sortie: string[] = [];
  for (const ligne of pdf.toString("latin1").split(/\r?\n/)) {
    if (!/(Tj|TJ)\s*$/.test(ligne)) continue;
    let texte = "";
    for (const h of ligne.matchAll(/<([0-9a-fA-F]+)>/g)) texte += decodeur.decode(Buffer.from(h[1], "hex"));
    sortie.push(texte);
  }
  return sortie;
}
const toutLeTexte = (pdf: Buffer) => textesDuPdf(pdf).join("\n");
const nombreDePages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

function etat(surcharges: Partial<EtatImprimable> = {}): EtatImprimable {
  return {
    identifiant: "etat-des-ventes",
    titre: "État des ventes",
    periode: { du: "2026-11-01", au: "2026-11-17" },
    entete: { nomBoutique: "Boutique Démo", lignesContact: ["Douala — Akwa", "Tél : 677 00 00 00"] },
    genereLe: "2026-11-17T14:21:00.000Z",
    sections: [
      {
        titre: "Récapitulatif par jour",
        colonnes: [
          { cle: "jour", libelle: "Jour", type: "date", alignement: "gauche" },
          { cle: "produit", libelle: "Article", type: "texte", alignement: "gauche" },
          { cle: "ttc", libelle: "Total TTC", type: "fcfa", alignement: "droite" },
        ],
        lignes: [
          ["2026-11-16", "Câble HDMI", 12500],
          ["2026-11-17", "Décodeur", -2500],
        ],
        totaux: ["Total", "", 10000],
      },
    ],
    avertissements: [],
    ...surcharges,
  };
}

const sansCompression = { compresser: false };

describe("texteCompatiblePdf : seul le jeu de caractères de la police standard (Windows-1252) passe", () => {
  it("garde les accents, l'apostrophe typographique, le tiret long, le point médian et la croix de multiplication", () => {
    expect(texteCompatiblePdf("Câble HDMI — Réabonnement n° 5 × 2 · l’état")).toBe("Câble HDMI — Réabonnement n° 5 × 2 · l’état");
  });

  it("ramène les espaces insécables (dont l'espace fine des nombres français) à une espace simple", () => {
    expect(texteCompatiblePdf("12\u202f500\u00a0FCFA")).toBe("12 500 FCFA");
  });

  it("remplace par « ? » ce que la police ne sait pas écrire, au lieu de produire un caractère cassé", () => {
    expect(texteCompatiblePdf("a→b ★")).toBe("a?b ?");
  });

  it("remplace les retours à la ligne par une espace : une cellule tient sur sa ligne", () => {
    expect(texteCompatiblePdf("ligne 1\nligne 2")).toBe("ligne 1 ligne 2");
  });
});

describe("rendreEtatPdf", () => {
  it("produit un vrai fichier PDF d'une page", async () => {
    const pdf = await rendreEtatPdf(etat(), sansCompression);

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1").trimEnd().endsWith("%%EOF")).toBe(true);
    expect(nombreDePages(pdf)).toBe(1);
  });

  it("dessine l'en-tête de la boutique, le titre, la période et la date de génération (heure de Douala)", async () => {
    const texte = toutLeTexte(await rendreEtatPdf(etat(), sansCompression));

    for (const attendu of ["Boutique Démo", "Douala — Akwa", "Tél : 677 00 00 00", "État des ventes", "Période : du 01/11/2026 au 17/11/2026", "Généré le 17/11/2026 15:21"]) {
      expect(texte).toContain(attendu);
    }
  });

  it("dessine le titre de la section, les titres de colonnes, les dates en JJ/MM/AAAA, les montants groupés par milliers et les totaux", async () => {
    const texte = toutLeTexte(await rendreEtatPdf(etat(), sansCompression));

    for (const attendu of ["Récapitulatif par jour", "Total TTC", "16/11/2026", "Câble HDMI", "12 500", "-2 500", "Total", "10 000"]) {
      expect(texte).toContain(attendu);
    }
  });

  it("n'écrit aucune espace insécable (la police ne l'a pas) ni point d'interrogation à la place d'un accent", async () => {
    const texte = toutLeTexte(await rendreEtatPdf(etat(), sansCompression));

    expect(texte).not.toMatch(/[\u00a0\u202f]/);
    expect(texte).not.toContain("C?ble");
    expect(texte).not.toContain("?tat");
  });

  it("une section sans ligne montre son message", async () => {
    const vide = etat({ sections: [{ titre: "Détail", colonnes: [{ cle: "a", libelle: "A", type: "texte", alignement: "gauche" }], lignes: [], messageVide: "Aucune vente sur cette période" }] });

    expect(toutLeTexte(await rendreEtatPdf(vide, sansCompression))).toContain("Aucune vente sur cette période");
  });

  it("montre les avertissements sous l'en-tête", async () => {
    const texte = toutLeTexte(await rendreEtatPdf(etat({ avertissements: ["Détail limité aux 2 premières factures : réduisez la période ou utilisez le CSV."] }), sansCompression));

    expect(texte).toContain("Attention : Détail limité aux 2 premières factures");
  });

  it("une cellule de texte très longue passe à la ligne sans rien perdre ni déborder sur une autre page", async () => {
    const long = "mot ".repeat(120).trim();
    const pdf = await rendreEtatPdf(etat({ sections: [{ titre: "Détail", colonnes: [{ cle: "d", libelle: "Détail", type: "texte", alignement: "gauche" }], lignes: [[long]] }] }), sansCompression);

    expect(nombreDePages(pdf)).toBe(1);
    expect(toutLeTexte(pdf).replace(/\s+/g, " ").match(/mot/g)).toHaveLength(120);
  });

  it("un long tableau passe sur plusieurs pages : titres de colonnes répétés, « Page i / n » en pied, aucune ligne perdue", async () => {
    const lignes = Array.from({ length: 200 }, (_, i) => [`2026-11-${String((i % 28) + 1).padStart(2, "0")}`, `Article ${i + 1}`, 1000 + i]);
    const pdf = await rendreEtatPdf(etat({ sections: [{ ...etat().sections[0], lignes, totaux: undefined }] }), sansCompression);
    const pages = nombreDePages(pdf);
    const texte = toutLeTexte(pdf);

    expect(pages).toBeGreaterThanOrEqual(4);
    expect((texte.match(/Total TTC/g) ?? []).length).toBeGreaterThanOrEqual(pages); // l'en-tête du tableau reparaît à chaque page
    expect(texte).toContain(`Page 1 / ${pages}`);
    expect(texte).toContain(`Page ${pages} / ${pages}`);
    expect(texte).toContain("Article 1");
    expect(texte).toContain("Article 200");
    expect((texte.match(/Article \d+/g) ?? []).length).toBe(200);
  });

  it("compressé par défaut : plus petit que la version lisible, et toujours un PDF valide de même nombre de pages", async () => {
    const lignes = Array.from({ length: 80 }, (_, i) => ["2026-11-03", `Article ${i}`, i]);
    const grand = etat({ sections: [{ ...etat().sections[0], lignes, totaux: undefined }] });
    const compresse = await rendreEtatPdf(grand);
    const lisible = await rendreEtatPdf(grand, sansCompression);

    expect(compresse.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(compresse.length).toBeLessThan(lisible.length);
    expect(nombreDePages(compresse)).toBe(nombreDePages(lisible));
  });

  it("des caractères hors jeu dans les données ne font pas échouer la génération", async () => {
    const pdf = await rendreEtatPdf(etat({ entete: { nomBoutique: "Boutique ★ Démo", lignesContact: [] } }), sansCompression);

    expect(toutLeTexte(pdf)).toContain("Boutique ? Démo");
  });
});

// Constaté en test de charge : un PDF d'un an (200 pages) bloquait le serveur près de 3 secondes, sans répondre aux autres requêtes. Le dessin rend donc
// la main au serveur tous les 100 lignes.
describe("rendreEtatPdf : rend la main au serveur pendant le dessin", () => {
  it("un long tableau n'est pas dessiné d'un seul bloc : les autres requêtes passent entre deux paquets de lignes", async () => {
    const lignes = Array.from({ length: 3000 }, (_, i) => [`2026-11-${String((i % 28) + 1).padStart(2, "0")}`, `Article ${i + 1}`, 1000 + i]);
    const grand = etat({ sections: [{ ...etat().sections[0], lignes, totaux: undefined }] });

    // une « autre requête » qui ne demande qu'un tour de boucle d'événements : elle n'avance que si le dessin cède la main
    let tours = 0;
    let actif = true;
    const autreRequete = (async () => {
      while (actif) {
        tours += 1;
        await cederLaMain();
      }
    })();
    const pdf = await rendreEtatPdf(grand, sansCompression);
    actif = false;
    await autreRequete;

    expect(tours).toBeGreaterThanOrEqual(25); // 3 000 lignes, une pause tous les 100
    // la pause ne change rien au document : toutes les lignes y sont, sur plusieurs pages
    expect((toutLeTexte(pdf).match(/Article \d+/g) ?? []).length).toBe(3000);
    expect(nombreDePages(pdf)).toBeGreaterThan(30);
  });
});
