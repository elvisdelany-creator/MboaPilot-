import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { obtenirCleChiffrement } from "./encryption-key.js";

const ALGORITHME = "aes-256-gcm";
const TAILLE_IV = 12;

let cleMemorisee: Buffer | null = null;
function cle(): Buffer {
  if (!cleMemorisee) cleMemorisee = obtenirCleChiffrement();
  return cleMemorisee;
}

// 11.2, 5.9 : chiffrement des données sensibles au repos (identifiants de
// comptes streaming partagés, mots de passe) — AES-256-GCM, IV aléatoire par
// valeur pour ne jamais réutiliser un couple (clé, IV). Le résultat encode
// iv:tag:données (hex) pour être auto-suffisant au déchiffrement.
export function chiffrer(texteClair: string): string {
  const iv = randomBytes(TAILLE_IV);
  const chiffreur = createCipheriv(ALGORITHME, cle(), iv);
  const chiffre = Buffer.concat([chiffreur.update(texteClair, "utf-8"), chiffreur.final()]);
  const tag = chiffreur.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), chiffre.toString("hex")].join(":");
}

export function dechiffrer(texteChiffre: string): string {
  const [ivHex, tagHex, donneesHex] = texteChiffre.split(":");
  const dechiffreur = createDecipheriv(ALGORITHME, cle(), Buffer.from(ivHex, "hex"));
  dechiffreur.setAuthTag(Buffer.from(tagHex, "hex"));
  const clair = Buffer.concat([dechiffreur.update(Buffer.from(donneesHex, "hex")), dechiffreur.final()]);
  return clair.toString("utf-8");
}
