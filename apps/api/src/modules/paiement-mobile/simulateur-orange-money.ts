import type { FournisseurPaiementMobile, InitierParams, StatutFournisseur } from "./fournisseur.js";

const DELAI_RESOLUTION_MS = 4000;

// ⚠️ Simulateur local — AUCUNE connexion réelle à l'API Orange Money.
// L'intégration officielle (souscription marchand, points d'accès, format
// des webhooks) nécessite des identifiants et une documentation à jour
// (developer.orange.com) hors de portée de cet environnement ; le module
// fournisseur.ts définit le contrat que le véritable adaptateur devra
// respecter pour remplacer ce simulateur sans toucher au cœur applicatif.
export class SimulateurOrangeMoney implements FournisseurPaiementMobile {
  private readonly transactions = new Map<string, { statut: StatutFournisseur; resoudreApres: number }>();

  async initier(params: InitierParams): Promise<{ referenceFournisseur: string }> {
    void params;
    const referenceFournisseur = `SIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.transactions.set(referenceFournisseur, { statut: "EN_ATTENTE", resoudreApres: Date.now() + DELAI_RESOLUTION_MS });
    return { referenceFournisseur };
  }

  async consulterStatut(referenceFournisseur: string): Promise<StatutFournisseur> {
    const transaction = this.transactions.get(referenceFournisseur);
    if (!transaction) return "ECHOUEE";
    if (transaction.statut === "EN_ATTENTE" && Date.now() >= transaction.resoudreApres) {
      transaction.statut = "REUSSIE";
    }
    return transaction.statut;
  }
}
