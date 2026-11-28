// Effet de bord, à importer EN PREMIER par les points d'entrée de la boutique (et par eux seuls) : fixe le dossier des données d'après la
// variable MBOAPILOT_DATA_DIR ou donnees.txt, avant que la base ne soit ouverte.
import { resoudreDossierBoutique, type DossierBoutique } from "./dossier-boutique.js";

function resoudreOuArreter(): DossierBoutique {
  try {
    return resoudreDossierBoutique();
  } catch (erreur) {
    console.error(`[MboaPilot] Démarrage impossible : ${(erreur as Error).message}`);
    process.exit(1);
  }
}

export const dossierBoutique = resoudreOuArreter();
if (dossierBoutique.origine !== "défaut") process.env.MBOAPILOT_DATA_DIR = dossierBoutique.dossier;
