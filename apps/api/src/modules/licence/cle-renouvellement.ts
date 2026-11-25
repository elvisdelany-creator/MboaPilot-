import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

// 10.4 : « jeton de licence signé (incluant le palier souscrit, la date d'expiration de l'abonnement et l'empreinte de l'installation) ».
// Une clé de renouvellement est un petit texte à coller : MBOA1.<contenu>.<signature>. La signature (Ed25519) n'est productible qu'avec la clé
// privée de l'éditeur ; l'application ne connaît que la clé publique, qui permet de vérifier mais pas de fabriquer. Le contenu est lisible
// (ce n'est pas un secret) mais toute modification invalide la signature.
export const PREFIXE_CLE = "MBOA1";
export const PALIERS_LICENCE = ["ESSENTIEL", "PRO", "RESEAU"] as const;
const LONGUEUR_MAX_CLE = 2000;

export interface ContenuCle {
  installation: string; // empreinte de l'installation à laquelle la clé est destinée
  expiration: string; // AAAA-MM-JJ, dernier jour couvert
  palier: string;
  emise: string; // AAAA-MM-JJ
}

const ILLISIBLE = `La clé de renouvellement est illisible : collez-la en entier (elle commence par ${PREFIXE_CLE}.)`;

export function lireClePublique(base64: string): KeyObject {
  try {
    const cle = createPublicKey({ key: Buffer.from(base64, "base64"), format: "der", type: "spki" });
    if (cle.asymmetricKeyType === "ed25519") return cle;
  } catch {
    // le message ci-dessous dit quoi faire : le détail technique n'aiderait pas
  }
  throw new Error("La clé publique de l'éditeur inscrite dans l'application est illisible (modules/licence/cle-publique-editeur.ts)");
}

export function emettreCle(clePriveePem: string, contenu: ContenuCle): string {
  const signe = `${PREFIXE_CLE}.${Buffer.from(JSON.stringify(contenu), "utf8").toString("base64url")}`;
  return `${signe}.${sign(null, Buffer.from(signe), createPrivateKey(clePriveePem)).toString("base64url")}`;
}

// vérifie la signature puis la forme du contenu ; les règles métier (installation, dates, formule) sont à l'appelant
export function lireCle(texte: unknown, clePublique: string): ContenuCle {
  if (typeof texte !== "string" || texte.trim() === "") throw new Error("La clé de renouvellement est obligatoire");
  // collée depuis un message ou un courriel, elle arrive souvent coupée en plusieurs lignes
  const cle = texte.replace(/\s+/g, "");
  const morceaux = cle.split(".");
  if (cle.length > LONGUEUR_MAX_CLE || morceaux.length !== 3 || morceaux[0] !== PREFIXE_CLE) throw new Error(ILLISIBLE);

  const [prefixe, corps, signature] = morceaux;
  if (!verify(null, Buffer.from(`${prefixe}.${corps}`), lireClePublique(clePublique), Buffer.from(signature, "base64url"))) {
    throw new Error("Cette clé n'a pas été signée par l'éditeur de MboaPilot, ou elle a été modifiée : demandez-en une nouvelle");
  }

  let contenu: Partial<ContenuCle> | null = null;
  try {
    contenu = JSON.parse(Buffer.from(corps, "base64url").toString("utf8")) as Partial<ContenuCle>;
  } catch {
    throw new Error(ILLISIBLE);
  }
  const { installation, expiration, palier, emise } = contenu ?? {};
  if (typeof installation !== "string" || typeof expiration !== "string" || typeof palier !== "string" || typeof emise !== "string") throw new Error(ILLISIBLE);
  return { installation, expiration, palier, emise };
}
