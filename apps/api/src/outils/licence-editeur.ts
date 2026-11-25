// Outil de l'ÉDITEUR (jamais lancé chez un client) : crée la paire de clés une fois pour toutes, puis émet les clés de renouvellement.
//
//   npm run licence:paire   -- --sortie D:\coffre\mboapilot-cle-privee.pem
//   npm run licence:emettre -- --cle D:\coffre\mboapilot-cle-privee.pem --installation <identifiant> --expiration 2027-12-31 [--palier PRO]
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DUREE_MAX_PROLONGATION_JOURS, emettreCle, PALIERS_LICENCE } from "../modules/licence/cle-renouvellement.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE_DEPOT = resolve(ICI, "../../../..");

const MODE_EMPLOI = `Commandes :
  paire    --sortie <fichier de la clé privée, hors du dépôt> [--remplacer]
  emettre  --cle <fichier de la clé privée> --installation <identifiant> --expiration <AAAA-MM-JJ> --palier ${PALIERS_LICENCE.join("|")}`;
// l'identifiant affiché par la carte Licence d'une boutique
const MOTIF_INSTALLATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ContexteOutil {
  fichierClePublique: string; // le fichier source qui porte la clé publique de l'application
  ecrire: (ligne: string) => void;
  aujourdHui: string; // AAAA-MM-JJ
  horodatage?: string; // instant d'émission inscrit dans la clé (à défaut, le jour) : départage deux clés émises le même jour
}

const MOTIF_CLE_PUBLIQUE = /CLE_PUBLIQUE_EDITEUR = "([^"]*)"/;

function option(args: string[], nom: string): string {
  const i = args.indexOf(nom);
  const valeur = i >= 0 ? args[i + 1] : undefined;
  if (!valeur || valeur.startsWith("--")) throw new Error(`L'option ${nom} est obligatoire\n${MODE_EMPLOI}`);
  return valeur;
}

function lireClePubliqueInscrite(fichier: string): { source: string; cle: string } {
  const source = readFileSync(fichier, "utf8");
  const trouvee = MOTIF_CLE_PUBLIQUE.exec(source);
  if (!trouvee) throw new Error(`Le fichier ${fichier} ne contient pas CLE_PUBLIQUE_EDITEUR`);
  return { source, cle: trouvee[1] };
}

const publiqueEnBase64 = (clePrivee: string) => createPublicKey(createPrivateKey(clePrivee)).export({ format: "der", type: "spki" }).toString("base64");

function creerPaire(args: string[], contexte: ContexteOutil): void {
  const sortie = resolve(option(args, "--sortie"));
  const depuisLeDepot = relative(RACINE_DEPOT, sortie);
  if (!depuisLeDepot.startsWith("..") && !isAbsolute(depuisLeDepot)) {
    throw new Error("La clé privée doit être écrite hors du dépôt de l'application (clé USB, coffre) : elle ne doit jamais être publiée");
  }
  const inscrite = lireClePubliqueInscrite(contexte.fichierClePublique);
  if (inscrite.cle !== "" && !args.includes("--remplacer")) {
    throw new Error("Une clé publique est déjà inscrite : en créer une autre rendrait inutilisables les clés déjà émises. Ajoutez --remplacer si c'est voulu");
  }
  if (existsSync(sortie)) throw new Error(`Le fichier ${sortie} existe déjà : une clé privée ne s'écrase pas`);

  const { privateKey } = generateKeyPairSync("ed25519");
  const privee = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  writeFileSync(sortie, privee, { flag: "wx", mode: 0o600 });
  writeFileSync(contexte.fichierClePublique, inscrite.source.replace(MOTIF_CLE_PUBLIQUE, `CLE_PUBLIQUE_EDITEUR = "${publiqueEnBase64(privee)}"`));

  contexte.ecrire(`Clé privée écrite dans ${sortie}`);
  contexte.ecrire(`Clé publique inscrite dans ${contexte.fichierClePublique}`);
  contexte.ecrire("Sauvegardez la clé privée en deux endroits sûrs : sans elle, plus aucune boutique ne peut être renouvelée. Quiconque la possède peut fabriquer des clés.");
  contexte.ecrire("Livrez ensuite l'application avec ce nouveau fichier : le renouvellement par clé sera actif.");
}

function emettre(args: string[], contexte: ContexteOutil): void {
  const fichier = option(args, "--cle");
  const installation = option(args, "--installation").trim().toLowerCase();
  const expiration = option(args, "--expiration");
  // obligatoire : la formule limite ce que la boutique peut faire, un oubli la ferait redescendre en Essentiel
  const palier = option(args, "--palier").toUpperCase();
  if (!MOTIF_INSTALLATION.test(installation)) {
    throw new Error("L'identifiant d'installation est incomplet ou mal recopié (36 caractères, par exemple 1b4e28ba-2fa1-4d3b-a3f5-ef19b5a0c9d2) : recopiez-le depuis la carte Licence de la boutique");
  }

  const instant = /^\d{4}-\d{2}-\d{2}$/.test(expiration) ? new Date(`${expiration}T00:00:00Z`) : null;
  if (!instant || Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== expiration) throw new Error("L'échéance doit être une date réelle au format AAAA-MM-JJ");
  if (expiration <= contexte.aujourdHui) throw new Error(`L'échéance demandée (${expiration}) est passée`);
  if (instant.getTime() - new Date(`${contexte.aujourdHui}T00:00:00Z`).getTime() > DUREE_MAX_PROLONGATION_JOURS * 86_400_000) {
    throw new Error(`L'échéance demandée (${expiration}) dépasse 10 ans : les boutiques refuseraient la clé`);
  }
  if (!(PALIERS_LICENCE as readonly string[]).includes(palier)) throw new Error(`Formule inconnue « ${palier} » — attendu : ${PALIERS_LICENCE.join(", ")}`);

  if (!existsSync(fichier)) throw new Error(`Clé privée introuvable : ${resolve(fichier)}`);
  const privee = readFileSync(fichier, "utf8");
  const inscrite = lireClePubliqueInscrite(contexte.fichierClePublique).cle;
  if (publiqueEnBase64(privee) !== inscrite) {
    throw new Error("Cette clé privée ne correspond pas à la clé publique inscrite dans l'application : la clé émise serait refusée par les boutiques");
  }

  contexte.ecrire(`Clé de renouvellement (${palier}, jusqu'au ${expiration}) pour l'installation ${installation} :`);
  contexte.ecrire(emettreCle(privee, { installation, expiration, palier, emise: contexte.horodatage ?? contexte.aujourdHui }));
}

export function executerOutilLicence(args: string[], contexte: ContexteOutil): void {
  const [commande, ...reste] = args;
  if (commande === "paire") return creerPaire(reste, contexte);
  if (commande === "emettre") return emettre(reste, contexte);
  throw new Error(MODE_EMPLOI);
}

// lancé en ligne de commande (et non importé par les tests)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    executerOutilLicence(process.argv.slice(2), {
      fichierClePublique: resolve(ICI, "../modules/licence/cle-publique-editeur.ts"),
      ecrire: (ligne) => console.log(ligne),
      aujourdHui: new Date().toISOString().slice(0, 10),
      horodatage: new Date().toISOString(),
    });
  } catch (erreur) {
    console.error(erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  }
}
