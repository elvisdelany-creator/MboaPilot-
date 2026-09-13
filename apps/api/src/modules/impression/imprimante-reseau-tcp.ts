import { connect } from "node:net";
import type { FournisseurImpression } from "./fournisseur.js";

const DELAI_CONNEXION_MS = 5000;

// 11.4 : envoie les octets ESC/POS bruts sur une connexion TCP directe —
// protocole "RAW/JetDirect" (port 9100 par défaut) supporté nativement par
// la quasi-totalité des imprimantes thermiques réseau, sans pilote ni
// dépendance à la boîte de dialogue d'impression du système.
export class ImprimanteReseauTcp implements FournisseurImpression {
  imprimer(hote: string, port: number, donnees: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: hote, port, timeout: DELAI_CONNEXION_MS });
      socket.once("connect", () => socket.end(donnees));
      socket.once("close", () => resolve());
      socket.once("timeout", () => socket.destroy(new Error(`Délai dépassé en se connectant à l'imprimante ${hote}:${port}`)));
      socket.once("error", (erreur) => reject(erreur));
    });
  }
}
