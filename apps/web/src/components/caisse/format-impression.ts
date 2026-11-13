import { useCallback, useState } from "react";

// Impression « A5 × 2 » : une feuille A4 en paysage qui porte la même facture deux fois, côte à côte (exemplaire client, exemplaire boutique).
// On coupe la feuille au milieu, sur le trait pointillé. Le ticket thermique 80 mm reste le format par défaut.
export type FormatImpression = "TICKET" | "A5X2";

const CLE_FORMAT = "mboapilot.formatImpression";

function lireFormat(): FormatImpression {
  try {
    return localStorage.getItem(CLE_FORMAT) === "A5X2" ? "A5X2" : "TICKET";
  } catch {
    return "TICKET"; // stockage indisponible (navigation privée, site bloqué) : le choix vaut pour la session seulement
  }
}

// le choix du format est une préférence du poste : il se retient d'une vente à l'autre
export function useFormatImpression() {
  const [format, setFormat] = useState<FormatImpression>(lireFormat);
  const changer = useCallback((suivant: FormatImpression) => {
    setFormat(suivant);
    try {
      localStorage.setItem(CLE_FORMAT, suivant);
    } catch {
      // le choix reste valable pour cette session
    }
  }, []);
  return [format, changer] as const;
}
