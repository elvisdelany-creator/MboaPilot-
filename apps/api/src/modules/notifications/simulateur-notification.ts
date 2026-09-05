import type { CanalNotification, EnvoyerParams, FournisseurNotification } from "./fournisseur.js";

// ⚠️ Simulateur local — AUCUNE connexion réelle à une passerelle SMS ou à un
// service d'e-mail. Toujours "réussi" : l'intégration officielle (passerelle
// SMS locale, service d'e-mail transactionnel) nécessite des identifiants
// hors de portée de cet environnement ; fournisseur.ts définit le contrat que
// le véritable adaptateur devra respecter pour remplacer ce simulateur.
export class SimulateurNotification implements FournisseurNotification {
  envoyer(canal: CanalNotification, params: EnvoyerParams): { reussi: boolean } {
    void canal;
    void params;
    return { reussi: true };
  }
}
