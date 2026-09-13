import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { ImprimanteReseauTcp } from "./imprimante-reseau-tcp.js";

let serveur: Server | undefined;

afterEach(() => {
  serveur?.close();
  serveur = undefined;
});

function demarrerServeurTest(recu: Buffer[]): Promise<number> {
  return new Promise((resolve) => {
    serveur = createServer((socket) => {
      socket.on("data", (donnees) => recu.push(donnees));
    });
    serveur.listen(0, "127.0.0.1", () => {
      const adresse = serveur!.address();
      resolve(typeof adresse === "object" && adresse !== null ? adresse.port : 0);
    });
  });
}

// 11.4 : "Compatibilité imprimante thermique 80mm (protocole ESC/POS)" — la
// plupart des imprimantes réseau exposent un port "RAW/JetDirect" (9100 par
// défaut) qui accepte directement des octets ESC/POS sur une connexion TCP brute.
describe("ImprimanteReseauTcp (11.4)", () => {
  it("envoie les octets fournis tels quels à l'hôte et au port configurés", async () => {
    const recu: Buffer[] = [];
    const port = await demarrerServeurTest(recu);

    await new ImprimanteReseauTcp().imprimer("127.0.0.1", port, Buffer.from([0x1b, 0x40, 0x41, 0x42]));

    expect(Buffer.concat(recu)).toEqual(Buffer.from([0x1b, 0x40, 0x41, 0x42]));
  });

  it("rejette si la connexion échoue (hôte injoignable)", async () => {
    await expect(new ImprimanteReseauTcp().imprimer("127.0.0.1", 1, Buffer.from([0x00]))).rejects.toThrow();
  });
});
