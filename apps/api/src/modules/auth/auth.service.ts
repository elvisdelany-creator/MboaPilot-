import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
import { validerMotDePasse } from "@mboapilot/shared";
import { trouverPolitiqueMotDePasseParSite } from "../entreprise/entreprise.repository.js";
import { trouverUtilisateurParIdentifiant, type Role } from "../utilisateurs/utilisateur.repository.js";

const MESSAGE_ERREUR = "Identifiants invalides";
const MESSAGE_VERROUILLE = "Compte temporairement verrouillé après plusieurs échecs de connexion. Réessayez dans quelques minutes.";
// hash factice pour égaliser le temps de réponse identifiant inconnu / mot de passe
// erroné et ne pas laisser fuiter, par canal temporel, l'existence d'un compte.
const HASH_FACTICE = bcrypt.hashSync("hash-factice-anti-timing", 12);

// 11.2 : "verrouillage après tentatives infructueuses répétées" — le cahier
// des charges ne fixe pas de seuil précis, valeurs par défaut usuelles.
const MAX_TENTATIVES = 5;
const DUREE_VERROUILLAGE_MINUTES = 15;

export interface UtilisateurAuthentifie {
  idUser: number;
  siteId: number;
  nom: string;
  prenom: string;
  identifiant: string;
  role: Role;
  idApporteur: number | null; // 2.5.1 : identifie "ses propres abonnés" pour le rôle APPORTEUR
}

// 2.5.1, 11.2 : authentification individuelle, message générique pour ne pas
// permettre l'énumération des identifiants existants. Verrouillage temporaire
// après plusieurs échecs consécutifs (11.2), horloge injectée pour testabilité.
// sansVerrouillage : démo publique, où les comptes sont partagés — un visiteur qui se trompe ne doit ni bloquer les suivants ni leur faire voir
// « compte verrouillé » (le plafond de connexions par adresse remplace le verrouillage, voir demo/limiteur-debit.ts)
export interface OptionsAuthentification {
  sansVerrouillage?: boolean;
}

type CompteTrouve = ReturnType<typeof trouverUtilisateurParIdentifiant>;

// phase 1 (avant le calcul bcrypt) : entrées valides, compte trouvé, verrouillage. Renvoie le hash à comparer.
function preparerAuthentification(db: Db, identifiant: string, motDePasse: string, maintenant: string, options: OptionsAuthentification) {
  // un identifiant ou un mot de passe qui n'est pas un texte (objet, nombre, tableau,
  // absent) ne peut correspondre à aucun compte : même message générique, sans
  // laisser remonter l'erreur interne de bcrypt ou de SQLite, et sans compter d'échec
  if (typeof identifiant !== "string" || typeof motDePasse !== "string") throw new Error(MESSAGE_ERREUR);

  const utilisateur = trouverUtilisateurParIdentifiant(db, identifiant);

  if (!options.sansVerrouillage && utilisateur && utilisateur.verrouilleJusqua !== null && utilisateur.verrouilleJusqua > maintenant) {
    throw new Error(MESSAGE_VERROUILLE);
  }

  return { utilisateur, hash: utilisateur?.motDePasseHash ?? HASH_FACTICE };
}

// phase 2 (après le calcul bcrypt) : compte actif et mot de passe valide, sinon échec compté ; remise à zéro du compteur sinon.
function conclureAuthentification(db: Db, compte: CompteTrouve, motDePasseValide: boolean, maintenant: string, options: OptionsAuthentification): UtilisateurAuthentifie {
  if (!compte || compte.actif !== 1 || !motDePasseValide) {
    if (compte && !options.sansVerrouillage) enregistrerEchecConnexion(db, compte.idUser, maintenant);
    throw new Error(MESSAGE_ERREUR);
  }

  // le compteur est déjà remis à 0 par enregistrerEchecConnexion au moment
  // même où le verrouillage se déclenche (voir plus bas) : une connexion
  // réussie après expiration du délai doit donc aussi effacer verrouilleJusqua,
  // pas seulement se fier à "tentativesEchouees > 0" pour le faire.
  if (compte.tentativesEchouees > 0 || compte.verrouilleJusqua !== null) {
    db.update(schema.utilisateur)
      .set({ tentativesEchouees: 0, verrouilleJusqua: null })
      .where(eq(schema.utilisateur.idUser, compte.idUser))
      .run();
  }

  const {
    motDePasseHash: _motDePasseHash,
    dateCreation: _dateCreation,
    actif: _actif,
    tentativesEchouees: _tentativesEchouees,
    verrouilleJusqua: _verrouilleJusqua,
    ...utilisateurSansHash
  } = compte;
  return utilisateurSansHash;
}

export function authentifier(db: Db, identifiant: string, motDePasse: string, maintenant = new Date().toISOString(), options: OptionsAuthentification = {}): UtilisateurAuthentifie {
  const { utilisateur, hash } = preparerAuthentification(db, identifiant, motDePasse, maintenant, options);
  return conclureAuthentification(db, utilisateur, bcrypt.compareSync(motDePasse, hash), maintenant, options);
}

// Même contrat que `authentifier`, mais la comparaison bcrypt rend la main au serveur entre deux morceaux de calcul : sur un petit serveur
// (la démo publique), une version synchrone fige tout, sonde de santé comprise, pendant ~2 s par tentative. Utilisée par la route de connexion.
export async function authentifierAsync(db: Db, identifiant: string, motDePasse: string, maintenant = new Date().toISOString(), options: OptionsAuthentification = {}): Promise<UtilisateurAuthentifie> {
  const { utilisateur, hash } = preparerAuthentification(db, identifiant, motDePasse, maintenant, options);
  const motDePasseValide = await bcrypt.compare(motDePasse, hash);
  return conclureAuthentification(db, utilisateur, motDePasseValide, maintenant, options);
}

// le compteur est relu ici, pas pris dans le compte lu avant le calcul : avec la vérification asynchrone, plusieurs tentatives simultanées
// liraient toutes 0 et n'en compteraient qu'une, ce qui affaiblirait le verrouillage.
function enregistrerEchecConnexion(db: Db, idUser: number, maintenant: string) {
  const courant = db.select({ tentativesEchouees: schema.utilisateur.tentativesEchouees }).from(schema.utilisateur).where(eq(schema.utilisateur.idUser, idUser)).get();
  const tentatives = (courant?.tentativesEchouees ?? 0) + 1;
  const verrouille = tentatives >= MAX_TENTATIVES;
  db.update(schema.utilisateur)
    .set({
      tentativesEchouees: verrouille ? 0 : tentatives,
      verrouilleJusqua: verrouille ? new Date(new Date(maintenant).getTime() + DUREE_VERROUILLAGE_MINUTES * 60_000).toISOString() : null,
    })
    .where(eq(schema.utilisateur.idUser, idUser))
    .run();
}

const TOURS_HACHAGE = 12;

// 2.5.1 : « authentification individuelle obligatoire » — chaque utilisateur choisit son mot de passe, qu'aucun
// administrateur n'a besoin de connaître. Le mot de passe actuel est revérifié par `authentifier` (un jeton volé ne
// suffit pas) : une erreur compte comme un échec de connexion et mène au verrouillage (11.2). Le nouveau suit la
// politique de complexité de l'entreprise, et la trace d'audit ne contient jamais de mot de passe.
export function changerSonMotDePasse(db: Db, idUser: number, motDePasseActuel: unknown, nouveauMotDePasse: unknown): void {
  if (typeof motDePasseActuel !== "string" || motDePasseActuel === "") throw new Error("Le mot de passe actuel est obligatoire");
  if (typeof nouveauMotDePasse !== "string") throw new Error("Le nouveau mot de passe doit être un texte");

  const utilisateur = db.select().from(schema.utilisateur).where(eq(schema.utilisateur.idUser, idUser)).get();
  if (!utilisateur || utilisateur.actif !== 1) throw new Error("Compte introuvable");

  try {
    authentifier(db, utilisateur.identifiant, motDePasseActuel);
  } catch (erreur) {
    // verrouillage : message d'origine ; sinon, mot de passe actuel erroné
    if ((erreur as Error).message === MESSAGE_VERROUILLE) throw erreur;
    throw new Error("Le mot de passe actuel est incorrect");
  }

  const erreurs = validerMotDePasse(nouveauMotDePasse, trouverPolitiqueMotDePasseParSite(db, utilisateur.siteId));
  if (erreurs.length > 0) throw new Error(erreurs.join(" — "));
  if (nouveauMotDePasse === motDePasseActuel) throw new Error("Le nouveau mot de passe doit être différent de l'actuel");

  db.transaction(() => {
    db.update(schema.utilisateur)
      .set({ motDePasseHash: bcrypt.hashSync(nouveauMotDePasse, TOURS_HACHAGE), tentativesEchouees: 0, verrouilleJusqua: null })
      .where(eq(schema.utilisateur.idUser, idUser))
      .run();
    db.insert(schema.journalAudit)
      .values({
        utilisateurId: idUser,
        action: "MODIFICATION",
        tableCible: "utilisateur",
        idCible: String(idUser),
        valeurApres: JSON.stringify({ action: "changement_mot_de_passe" }),
      })
      .run();
  });
}

