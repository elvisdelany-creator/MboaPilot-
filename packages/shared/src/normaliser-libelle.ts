// 5.2, 8.2 : un tableur ou une ressaisie perd souvent les accents (copier-coller,
// encodage) — tout rapprochement d'article par libellé doit rester insensible
// à la casse ET aux accents, sinon une ligne/un transfert sans accent crée un
// doublon au lieu de reconnaître l'article existant.
// Les espaces comptent pour une seule : un tableur français met une espace INSÉCABLE entre les mots, une ressaisie en
// laisse parfois deux — « Écran  Plat » et « Écran Plat » sont le même article (\s couvre aussi l'insécable, la fine
// insécable et la tabulation).
export function normaliserLibelle(libelle: string): string {
  return libelle
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
