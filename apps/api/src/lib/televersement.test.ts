import { describe, expect, it } from "vitest";
import { FichierTropGrosError, lireFichierTeleverse } from "./televersement.js";

// 11.2 : constaté en test grandeur nature — un logo de 3 Mo envoyé au serveur réel (client
// et serveur dans deux processus) était accepté (201) et enregistré TRONQUÉ à 2 Mo, alors
// que le même envoi donnait 413 dans un test en mémoire : @fastify/multipart tronque le
// flux et, selon le rythme d'arrivée des données, ne lève pas toujours l'exception. Le
// drapeau « tronqué » doit donc être vérifié explicitement, jamais seulement l'exception.
function requeteFactice(fichier: object | undefined) {
  return { file: async () => fichier } as never;
}

describe("lireFichierTeleverse", () => {
  it("renvoie le contenu, le nom et le type d'un fichier complet", async () => {
    const resultat = await lireFichierTeleverse(
      requeteFactice({ toBuffer: async () => Buffer.from("abc"), file: { truncated: false }, filename: "logo.png", mimetype: "image/png" }),
      1000
    );
    expect(resultat.contenu.toString()).toBe("abc");
    expect(resultat.nomFichierOriginal).toBe("logo.png");
    expect(resultat.typeMime).toBe("image/png");
  });

  it("refuse un fichier tronqué MÊME quand toBuffer() n'a pas levé d'exception", async () => {
    await expect(
      lireFichierTeleverse(requeteFactice({ toBuffer: async () => Buffer.from("tronque"), file: { truncated: true }, filename: "gros.png", mimetype: "image/png" }), 1000)
    ).rejects.toBeInstanceOf(FichierTropGrosError);
  });

  it("traduit l'exception de dépassement de taille de la bibliothèque", async () => {
    const depassement = Object.assign(new Error("request file too large"), { code: "FST_REQ_FILE_TOO_LARGE" });
    await expect(
      lireFichierTeleverse(requeteFactice({ toBuffer: async () => { throw depassement; }, file: { truncated: true }, filename: "gros.png", mimetype: "image/png" }), 1000)
    ).rejects.toBeInstanceOf(FichierTropGrosError);
  });

  it("refuse l'absence de fichier", async () => {
    await expect(lireFichierTeleverse(requeteFactice(undefined), 1000)).rejects.toThrow(/Aucun fichier/);
  });

  it("laisse passer les autres erreurs telles quelles", async () => {
    await expect(
      lireFichierTeleverse(requeteFactice({ toBuffer: async () => { throw new Error("flux interrompu"); }, file: { truncated: false }, filename: "a.png", mimetype: "image/png" }), 1000)
    ).rejects.toThrow("flux interrompu");
  });

  it("transmet la taille maximale à la bibliothèque", async () => {
    let limites: unknown;
    const requete = { file: async (options: unknown) => { limites = options; return { toBuffer: async () => Buffer.alloc(0), file: { truncated: false }, filename: "a", mimetype: "image/png" }; } } as never;
    await lireFichierTeleverse(requete, 2048);
    expect(limites).toEqual({ limits: { fileSize: 2048 } });
  });
});
