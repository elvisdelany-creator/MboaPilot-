// 11.2 : type réel d'un fichier image d'après sa signature (octets de tête). Le type MIME
// d'un téléversement est déclaré par le client et ne prouve rien : un HTML, un script ou
// un exécutable annoncé « image/png » était accepté, stocké puis servi comme image.
// SVG volontairement exclu (peut contenir du script).
const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function typeImageDetecte(contenu: Buffer): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  if (contenu.length >= 8 && contenu.subarray(0, 8).equals(SIGNATURE_PNG)) return "image/png";
  if (contenu.length >= 3 && contenu[0] === 0xff && contenu[1] === 0xd8 && contenu[2] === 0xff) return "image/jpeg";
  if (contenu.length >= 6 && ["GIF87a", "GIF89a"].includes(contenu.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (contenu.length >= 12 && contenu.subarray(0, 4).toString("latin1") === "RIFF" && contenu.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
