import { useEffect, useState } from "react";
import { chargerEtatDemo, type EtatDemo } from "./api";

// L'état « démo publique » ne change pas pendant la vie de la page : une seule demande au serveur, partagée par l'écran de connexion
// et par le bandeau de l'en-tête. Une erreur (serveur injoignable, ancienne version) vaut « pas une démo ».
let demande: Promise<EtatDemo> | null = null;

export function lireEtatDemo(): Promise<EtatDemo> {
  demande ??= chargerEtatDemo().catch(() => ({ actif: false }));
  return demande;
}

// null tant que la réponse n'est pas arrivée
export function useEtatDemo(): EtatDemo | null {
  const [etat, setEtat] = useState<EtatDemo | null>(null);
  useEffect(() => {
    let encore = true;
    lireEtatDemo().then((e) => {
      if (encore) setEtat(e);
    });
    return () => {
      encore = false;
    };
  }, []);
  return etat;
}
