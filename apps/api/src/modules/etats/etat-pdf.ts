import PDFDocument from "pdfkit";
import { cederLaMain } from "../../lib/ceder-la-main.js";
import { dateHeureDouala, formaterValeurEtat, libellePeriodeEtat, type ColonneEtat, type EtatImprimable, type SectionEtat } from "@mboapilot/shared";

// Rendu PDF d'un état : A4 portrait, police standard Helvetica (accents français gérés), tableaux dont l'en-tête reparaît à chaque page, « Page i / n »
// en pied. Aucun composant natif, aucun navigateur : le fichier est fabriqué par le serveur, sans Internet.

const LARGEUR_PAGE = 595.28;
const HAUTEUR_PAGE = 841.89;
const MARGE = 40;
const LARGEUR_UTILE = LARGEUR_PAGE - 2 * MARGE;
// au-delà de cette ordonnée : saut de page (le bas de la page est réservé au pied de page)
const Y_MAX = HAUTEUR_PAGE - MARGE - 14;
const MARGE_CELLULE = 3;
const TAILLE_TEXTE = 8.5;
const LARGEURS_FIXES = { date: 58, entier: 44, fcfa: 72 } as const;
const POLICE = "Helvetica";
const POLICE_GRAS = "Helvetica-Bold";
const POLICE_ITALIQUE = "Helvetica-Oblique";
// le dessin rend la main au serveur tous les 100 lignes : un PDF d'un an (200 pages) bloquait sinon le serveur près de 3 secondes
const LIGNES_PAR_PAUSE = 100;

// Les caractères de la police standard hors ASCII et Latin-1 : le jeu « Windows-1252 » (guillemets typographiques, tirets, point médian, ‰, œ…)
const AUTRES_WIN_ANSI = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013,
  0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

// Ce que la police ne sait pas écrire devient « ? » plutôt qu'un caractère cassé ; les espaces insécables (dont l'espace fine des nombres français, que
// la police n'a pas) deviennent des espaces simples ; une cellule tient sur sa ligne.
export function texteCompatiblePdf(texte: string): string {
  return Array.from(texte.replace(/[\u00a0\u2007\u2009\u202f]/g, " ").replace(/[\r\n]+/g, " "))
    .map((caractere) => {
      const point = caractere.codePointAt(0) ?? 0;
      return (point >= 0x20 && point <= 0x7e) || (point >= 0xa1 && point <= 0xff) || AUTRES_WIN_ANSI.has(point) ? caractere : "?";
    })
    .join("");
}

function largeursColonnes(colonnes: ColonneEtat[]): number[] {
  const fixe = colonnes.reduce((total, c) => total + (c.type === "texte" ? 0 : LARGEURS_FIXES[c.type]), 0);
  const poidsTotal = colonnes.reduce((total, c) => total + (c.type === "texte" ? (c.poids ?? 1) : 0), 0);
  const reste = Math.max(LARGEUR_UTILE - fixe, 0);
  return colonnes.map((c) => (c.type === "texte" ? (reste * (c.poids ?? 1)) / poidsTotal : LARGEURS_FIXES[c.type]));
}

type StyleLigne = "entete" | "normale" | "total";
const policeDe = (style: StyleLigne) => (style === "normale" ? POLICE : POLICE_GRAS);

function hauteurLigne(doc: PDFKit.PDFDocument, cellules: string[], largeurs: number[], style: StyleLigne): number {
  doc.font(policeDe(style)).fontSize(TAILLE_TEXTE);
  const hauteurs = cellules.map((texte, i) => doc.heightOfString(texte, { width: largeurs[i] - 2 * MARGE_CELLULE }));
  return Math.max(...hauteurs, TAILLE_TEXTE) + 2 * MARGE_CELLULE;
}

// dessine une ligne de tableau à l'ordonnée y et renvoie l'ordonnée suivante
function dessinerLigne(doc: PDFKit.PDFDocument, cellules: string[], colonnes: ColonneEtat[], largeurs: number[], y: number, style: StyleLigne): number {
  const hauteur = hauteurLigne(doc, cellules, largeurs, style);
  if (style === "entete") doc.rect(MARGE, y, LARGEUR_UTILE, hauteur).fill("#e8e8e8");
  doc.fillColor("#000000").font(policeDe(style)).fontSize(TAILLE_TEXTE);
  let x = MARGE;
  cellules.forEach((texte, i) => {
    doc.text(texte, x + MARGE_CELLULE, y + MARGE_CELLULE, { width: largeurs[i] - 2 * MARGE_CELLULE, align: colonnes[i].alignement === "droite" ? "right" : "left" });
    x += largeurs[i];
  });
  const epaisseur = style === "total" ? 1 : 0.4;
  doc.moveTo(MARGE, y + hauteur).lineTo(MARGE + LARGEUR_UTILE, y + hauteur).lineWidth(epaisseur).strokeColor(style === "total" ? "#000000" : "#bbbbbb").stroke();
  return y + hauteur;
}

function dessinerEntete(doc: PDFKit.PDFDocument, etat: EtatImprimable): number {
  let y = MARGE;
  doc.font(POLICE_GRAS).fontSize(14).fillColor("#000000").text(texteCompatiblePdf(etat.entete.nomBoutique), MARGE, y, { width: LARGEUR_UTILE });
  y = doc.y;
  doc.font(POLICE).fontSize(TAILLE_TEXTE).fillColor("#333333");
  for (const ligne of etat.entete.lignesContact) {
    doc.text(texteCompatiblePdf(ligne), MARGE, y, { width: LARGEUR_UTILE });
    y = doc.y;
  }
  y += 10;
  doc.font(POLICE_GRAS).fontSize(16).fillColor("#000000").text(texteCompatiblePdf(etat.titre), MARGE, y, { width: LARGEUR_UTILE });
  y = doc.y + 2;
  doc.font(POLICE).fontSize(10).text(texteCompatiblePdf(`Période : ${libellePeriodeEtat(etat.periode)}`), MARGE, y, { width: LARGEUR_UTILE });
  y = doc.y + 2;
  doc.fontSize(TAILLE_TEXTE).fillColor("#555555").text(texteCompatiblePdf(`Généré le ${dateHeureDouala(etat.genereLe)}`), MARGE, y, { width: LARGEUR_UTILE });
  y = doc.y + 6;
  for (const avertissement of etat.avertissements) {
    doc.font(POLICE_GRAS).fontSize(9).fillColor("#8a1c1c").text(texteCompatiblePdf(`Attention : ${avertissement}`), MARGE, y, { width: LARGEUR_UTILE });
    y = doc.y + 2;
  }
  return y + 10;
}

async function dessinerSection(doc: PDFKit.PDFDocument, section: SectionEtat, yDepart: number): Promise<number> {
  const { colonnes } = section;
  const largeurs = largeursColonnes(colonnes);
  const libelles = colonnes.map((c) => texteCompatiblePdf(c.libelle));
  const cellulesDe = (ligne: (string | number)[]) => ligne.map((valeur, i) => texteCompatiblePdf(formaterValeurEtat(valeur, colonnes[i].type)));
  let y = yDepart;

  // le titre et l'en-tête du tableau ne restent jamais seuls en bas de page : il faut la place d'au moins une ligne en dessous
  if (y + 18 + hauteurLigne(doc, libelles, largeurs, "entete") + 22 > Y_MAX) {
    doc.addPage();
    y = MARGE;
  }
  doc.font(POLICE_GRAS).fontSize(10.5).fillColor("#000000").text(texteCompatiblePdf(section.titre), MARGE, y, { width: LARGEUR_UTILE });
  y += 18;
  y = dessinerLigne(doc, libelles, colonnes, largeurs, y, "entete");

  const nouvellePage = (): number => {
    doc.addPage();
    return dessinerLigne(doc, libelles, colonnes, largeurs, MARGE, "entete");
  };

  if (section.lignes.length === 0) {
    doc.font(POLICE_ITALIQUE).fontSize(TAILLE_TEXTE).fillColor("#444444").text(texteCompatiblePdf(section.messageVide ?? "Aucune donnée"), MARGE + MARGE_CELLULE, y + MARGE_CELLULE, { width: LARGEUR_UTILE });
    y += 18;
  }
  let dessinees = 0;
  for (const ligne of section.lignes) {
    if (++dessinees % LIGNES_PAR_PAUSE === 0) await cederLaMain();
    const cellules = cellulesDe(ligne);
    if (y + hauteurLigne(doc, cellules, largeurs, "normale") > Y_MAX) y = nouvellePage();
    y = dessinerLigne(doc, cellules, colonnes, largeurs, y, "normale");
  }
  if (section.totaux) {
    const cellules = cellulesDe(section.totaux);
    if (y + hauteurLigne(doc, cellules, largeurs, "total") > Y_MAX) y = nouvellePage();
    y = dessinerLigne(doc, cellules, colonnes, largeurs, y, "total");
  }
  return y + 16;
}

export async function rendreEtatPdf(etat: EtatImprimable, options: { compresser?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGE,
    bufferPages: true,
    compress: options.compresser !== false,
    info: { Title: etat.titre, Author: "MboaPilot", Subject: `${etat.entete.nomBoutique} — ${libellePeriodeEtat(etat.periode)}` },
  });
  const morceaux: Buffer[] = [];
  doc.on("data", (morceau: Buffer) => morceaux.push(morceau));
  const termine = new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  let y = dessinerEntete(doc, etat);
  for (const section of etat.sections) y = await dessinerSection(doc, section, y);

  // pied de page, une fois le nombre de pages connu ; la marge basse est annulée le temps de l'écrire, sinon pdfkit ajouterait une page
  const { start, count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    doc.page.margins.bottom = 0;
    doc.font(POLICE).fontSize(8).fillColor("#666666").text(texteCompatiblePdf(`${etat.titre} — Page ${i + 1} / ${count}`), MARGE, HAUTEUR_PAGE - MARGE + 6, {
      width: LARGEUR_UTILE,
      align: "right",
      lineBreak: false,
    });
  }

  doc.end();
  await termine;
  return Buffer.concat(morceaux);
}
