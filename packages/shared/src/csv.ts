// 8.2 : import/export de catalogue (CSV) — parseur/générateur minimal
// (RFC 4180 : champs entre guillemets, virgule/guillemet/saut de ligne échappés).

// Excel en version française enregistre ses CSV avec « ; » : le séparateur est
// déduit de la ligne d'en-tête (hors guillemets), « , » par défaut.
function detecterSeparateur(texte: string): "," | ";" {
  let virgules = 0;
  let pointsVirgules = 0;
  let dansGuillemets = false;
  for (const c of texte) {
    if (c === '"') dansGuillemets = !dansGuillemets;
    else if (!dansGuillemets && (c === "\n" || c === "\r")) break;
    else if (!dansGuillemets && c === ",") virgules++;
    else if (!dansGuillemets && c === ";") pointsVirgules++;
  }
  return pointsVirgules > virgules ? ";" : ",";
}

function decouperLignesCsv(texte: string): string[][] {
  const separateur = detecterSeparateur(texte);
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let dansGuillemets = false;

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];

    if (dansGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') {
          champ += '"';
          i++;
        } else {
          dansGuillemets = false;
        }
      } else {
        champ += c;
      }
      continue;
    }

    if (c === '"') {
      dansGuillemets = true;
    } else if (c === separateur) {
      ligne.push(champ);
      champ = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = "";
    } else {
      champ += c;
    }
  }
  ligne.push(champ);
  lignes.push(ligne);

  // ignore les lignes entièrement vides (fin de fichier notamment)
  return lignes.filter((l) => l.some((champ) => champ.trim() !== ""));
}

export function analyserCsv(texte: string): Record<string, string>[] {
  const lignes = decouperLignesCsv(texte);
  if (lignes.length === 0) return [];

  const entetes = lignes[0].map((e) => e.trim());
  return lignes.slice(1).map((champs) => {
    const objet: Record<string, string> = {};
    entetes.forEach((entete, i) => {
      objet[entete] = (champs[i] ?? "").trim();
    });
    return objet;
  });
}

function echapperChampCsv(valeur: string | number): string {
  const s = String(valeur);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function construireCsv(entetes: string[], lignes: (string | number)[][]): string {
  return [entetes, ...lignes].map((ligne) => ligne.map(echapperChampCsv).join(",")).join("\r\n");
}
