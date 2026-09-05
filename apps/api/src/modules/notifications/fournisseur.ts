export type CanalNotification = "SMS" | "EMAIL";

export interface EnvoyerParams {
  destinataire: string;
  message: string;
}

// 4.4, 13.2 : couche d'abstraction "fournisseur de notification" — permet de
// brancher une passerelle SMS locale et/ou un service d'e-mail réels sans
// modifier le cœur applicatif (job quotidien, cycle SAV). Contrairement au
// paiement mobile (fournisseur.ts, 6.6), l'envoi n'a pas de cycle de vie
// asynchrone à interroger : un aller simple avec un résultat immédiat suffit
// à représenter aussi bien une vraie passerelle HTTP qu'un simulateur local.
export interface FournisseurNotification {
  envoyer(canal: CanalNotification, params: EnvoyerParams): { reussi: boolean };
}
