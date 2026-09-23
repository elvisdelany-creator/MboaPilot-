// 5.2, 8.2 : un tableur ou une ressaisie perd souvent les accents (copier-coller,
// encodage) — tout rapprochement d'article par libellé doit rester insensible
// à la casse ET aux accents, sinon une ligne/un transfert sans accent crée un
// doublon au lieu de reconnaître l'article existant.
export function normaliserLibelle(libelle: string): string {
  return libelle
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}
