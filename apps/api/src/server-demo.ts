// Lanceur de la DÉMO PUBLIQUE (boutique d'essai ouverte sur Internet) : `npm run start:demo`.
//
// Jamais sur les vraies données d'une boutique : la démo travaille dans son PROPRE dossier jetable, effacé et reconstruit à chaque
// démarrage (boutique fictive, voir demo/seed-demo.ts). Sur un hébergement à disque éphémère (Render gratuit), chaque réveil repart donc
// d'une démo neuve ; sur un serveur permanent, MBOAPILOT_DEMO_REDEMARRAGE_HEURES programme un redémarrage (le superviseur relance le processus).
//
// Variables : PORT (imposé par l'hébergeur), MBOAPILOT_DEMO_DIR (dossier jetable, son nom doit contenir « demo »),
// MBOAPILOT_DEMO_REDEMARRAGE_HEURES (0 ou absent : jamais), JWT_SECRET et MBOAPILOT_ENCRYPTION_KEY (recommandées en hébergement).
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const dossierDemo = resolve(process.env.MBOAPILOT_DEMO_DIR ?? join(tmpdir(), "mboapilot-demo"));
// garde-fou : ce dossier est EFFACÉ à chaque démarrage. Un chemin qui ne dit pas « demo » est peut-être celui de vraies données.
if (!basename(dossierDemo).toLowerCase().includes("demo")) {
  console.error(`[MboaPilot démo] Démarrage refusé : le dossier « ${dossierDemo} » sera effacé, son nom doit contenir « demo ».`);
  process.exit(1);
}
rmSync(dossierDemo, { recursive: true, force: true });
mkdirSync(dossierDemo, { recursive: true });

// tout (base, sauvegardes, clés, photos, logos) dans le dossier de la démo : les variables historiques qui désigneraient ailleurs sont ignorées
process.env.MBOAPILOT_DEMO = "1";
process.env.MBOAPILOT_DATA_DIR = dossierDemo;
delete process.env.MBOAPILOT_DB_PATH;
delete process.env.MBOAPILOT_BACKUPS_DIR;
process.env.MBOAPILOT_HOTE ??= "0.0.0.0";

// importations dynamiques : la base s'ouvre à l'import de db/client, donc APRÈS la fixation du dossier ci-dessus
const { db } = await import("./db/client.js");
const { appliquerMigrations } = await import("./db/appliquer-migrations.js");
const { peuplerDemo } = await import("./demo/seed-demo.js");
const { revaliderLicence } = await import("./modules/licence/licence.service.js");

appliquerMigrations(db);
peuplerDemo(db);
console.log(`[MboaPilot démo] Boutique fictive prête dans ${dossierDemo}`);

// la licence passe en lecture seule après 21 jours sans revalidation, qui n'a lieu qu'au démarrage : une démo qui tourne longtemps la
// renouvelle elle-même
setInterval(() => revaliderLicence(db, new Date().toISOString()), 12 * 3600 * 1000).unref();

const heures = Number(process.env.MBOAPILOT_DEMO_REDEMARRAGE_HEURES ?? 0);
if (Number.isFinite(heures) && heures > 0) {
  setTimeout(() => {
    console.log(`[MboaPilot démo] Redémarrage programmé après ${heures} h : la démo repart de zéro.`);
    process.exit(0);
  }, heures * 3600 * 1000).unref();
}

await import("./server.js");
