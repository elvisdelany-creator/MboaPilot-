import { describe, expect, it } from "vitest";
import { typeImageDetecte } from "./images.js";
import { GIF_FACTICE, JPEG_FACTICE, PNG_FACTICE, WEBP_FACTICE } from "../test-utils/images.js";

// 11.2 : « jamais de confiance aveugle dans l'entrée utilisateur » — le type MIME d'un
// téléversement est déclaré par le client ; seul le contenu (signature du fichier)
// prouve qu'il s'agit bien d'une image.
describe("typeImageDetecte", () => {
  it.each([
    ["PNG", PNG_FACTICE, "image/png"],
    ["JPEG", JPEG_FACTICE, "image/jpeg"],
    ["GIF", GIF_FACTICE, "image/gif"],
    ["WebP", WEBP_FACTICE, "image/webp"],
  ])("reconnaît un fichier %s d'après sa signature", (_nom, contenu, attendu) => {
    expect(typeImageDetecte(contenu)).toBe(attendu);
  });

  it.each([
    ["HTML", Buffer.from("<html><script>alert(1)</script></html>")],
    ["SVG (peut contenir du script)", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["PDF", Buffer.from("%PDF-1.7 ...")],
    ["exécutable Windows", Buffer.from("MZ\x90\x00\x03")],
    ["texte quelconque", Buffer.from("contenu-image-factice")],
    ["fichier vide", Buffer.alloc(0)],
    ["signature PNG tronquée", PNG_FACTICE.subarray(0, 5)],
    ["RIFF qui n'est pas du WebP (WAV)", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")])],
  ])("refuse un fichier %s", (_nom, contenu) => {
    expect(typeImageDetecte(contenu)).toBeNull();
  });
});
