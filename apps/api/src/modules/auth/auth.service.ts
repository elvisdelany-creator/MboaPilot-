import bcrypt from "bcryptjs";
import type { Db } from "../../db/types.js";
import { trouverUtilisateurParIdentifiant, type Role } from "../utilisateurs/utilisateur.repository.js";

const MESSAGE_ERREUR = "Identifiants invalides";
// hash factice pour égaliser le temps de réponse identifiant inconnu / mot de passe
// erroné et ne pas laisser fuiter, par canal temporel, l'existence d'un compte.
const HASH_FACTICE = bcrypt.hashSync("hash-factice-anti-timing", 12);

export interface UtilisateurAuthentifie {
  idUser: number;
  siteId: number;
  nom: string;
  prenom: string;
  identifiant: string;
  role: Role;
}

// 2.5.1, 11.2 : authentification individuelle, message générique pour ne pas
// permettre l'énumération des identifiants existants.
export function authentifier(db: Db, identifiant: string, motDePasse: string): UtilisateurAuthentifie {
  const utilisateur = trouverUtilisateurParIdentifiant(db, identifiant);
  const motDePasseValide = bcrypt.compareSync(motDePasse, utilisateur?.motDePasseHash ?? HASH_FACTICE);

  if (!utilisateur || utilisateur.actif !== 1 || !motDePasseValide) {
    throw new Error(MESSAGE_ERREUR);
  }

  const { motDePasseHash: _motDePasseHash, dateCreation: _dateCreation, actif: _actif, ...utilisateurSansHash } = utilisateur;
  return utilisateurSansHash;
}
