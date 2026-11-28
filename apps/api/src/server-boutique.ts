// Lanceur du serveur de la BOUTIQUE (`npm start`, donc lancer-mboapilot.bat) : lit donnees.txt et refuse de démarrer sur un dossier vide pris
// pour la boutique. Le développement (`npm run dev`), les essais et la démo publique passent par server.ts, qui ignore donnees.txt.
import { dossierBoutique } from "./config/appliquer-donnees-txt.js";
import { memoriserDossierHabituel, RACINE_APPLICATION, verifierDossierHabituel } from "./config/dossier-boutique.js";

try {
  for (const avertissement of verifierDossierHabituel(RACINE_APPLICATION, dossierBoutique)) console.warn(`[MboaPilot] ${avertissement}`);
} catch (erreur) {
  console.error(`[MboaPilot] Démarrage impossible : ${(erreur as Error).message}`);
  process.exit(1);
}
console.log(`[MboaPilot] Dossier des données : ${dossierBoutique.dossier}`);

// importations dynamiques : la base s'ouvre à l'import de db/client, donc après les contrôles ci-dessus
await import("./server.js");
const { db } = await import("./db/client.js");
const schema = await import("./db/schema.js");

const memoriser = () => memoriserDossierHabituel(RACINE_APPLICATION, dossierBoutique, db.select().from(schema.utilisateur).limit(1).get() !== undefined);
function memoriserSansArreter() {
  try {
    memoriser();
  } catch (erreur) {
    console.error("[MboaPilot] Dossier des données non mémorisé :", erreur);
  }
}
memoriserSansArreter();
// une première installation se fait après le démarrage
setInterval(memoriserSansArreter, 60 * 1000).unref();
