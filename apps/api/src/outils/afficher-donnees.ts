// Appelé par lancer-mboapilot.bat avant de démarrer : affiche le dossier des données, ou dit pourquoi ne pas démarrer.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { dossierBoutique } from "../config/appliquer-donnees-txt.js";
import { RACINE_APPLICATION, verifierDossierHabituel } from "../config/dossier-boutique.js";

try {
  const avertissements = verifierDossierHabituel(RACINE_APPLICATION, dossierBoutique);
  console.log(`Dossier des donnees : ${dossierBoutique.dossier}`);
  for (const avertissement of avertissements) console.log(avertissement);
  if (!existsSync(join(dossierBoutique.dossier, "mboapilot.db"))) {
    console.log("Nouvelle boutique : ce dossier ne contient pas encore de donnees. Si vous en avez deja, fermez cette fenetre et verifiez donnees.txt.");
  }
} catch (erreur) {
  console.error(`[MboaPilot] Démarrage impossible : ${(erreur as Error).message}`);
  process.exit(1);
}
