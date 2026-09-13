import type { FournisseurImpression } from "./fournisseur.js";

// Double de test — enregistre les envois sans connexion réseau réelle, pour
// vérifier le contenu du ticket sans dépendre d'une imprimante physique.
export class SimulateurImpression implements FournisseurImpression {
  readonly envois: { hote: string; port: number; donnees: Buffer }[] = [];

  async imprimer(hote: string, port: number, donnees: Buffer): Promise<void> {
    this.envois.push({ hote, port, donnees });
  }
}
