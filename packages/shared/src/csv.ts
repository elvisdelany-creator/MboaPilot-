// 8.2 : import/export de catalogue (CSV) — parseur/générateur minimal
// (RFC 4180 : champs entre guillemets, virgule/guillemet/saut de ligne échappés).

function decouperLignesCsv(texte: string): string[][] {
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
    } else if (c === ",") {
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
