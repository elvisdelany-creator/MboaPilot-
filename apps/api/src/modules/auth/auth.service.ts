import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/types.js";
import * as schema from "../../db/schema.js";
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
export function authentifier(db: Db, identifiant: string, motDePasse: string, maintenant = new Date().toISOString()): UtilisateurAuthentifie {
  const utilisateur = trouverUtilisateurParIdentifiant(db, identifiant);

  if (utilisateur && utilisateur.verrouilleJusqua !== null && utilisateur.verrouilleJusqua > maintenant) {
    throw new Error(MESSAGE_VERROUILLE);
  }

  const motDePasseValide = bcrypt.compareSync(motDePasse, utilisateur?.motDePasseHash ?? HASH_FACTICE);

  if (!utilisateur || utilisateur.actif !== 1 || !motDePasseValide) {
    if (utilisateur) enregistrerEchecConnexion(db, utilisateur, maintenant);
    throw new Error(MESSAGE_ERREUR);
  }

  if (utilisateur.tentativesEchouees > 0) {
    db.update(schema.utilisateur)
      .set({ tentativesEchouees: 0, verrouilleJusqua: null })
      .where(eq(schema.utilisateur.idUser, utilisateur.idUser))
      .run();
  }

  const {
    motDePasseHash: _motDePasseHash,
    dateCreation: _dateCreation,
    actif: _actif,
    tentativesEchouees: _tentativesEchouees,
    verrouilleJusqua: _verrouilleJusqua,
    ...utilisateurSansHash
  } = utilisateur;
  return utilisateurSansHash;
}

function enregistrerEchecConnexion(db: Db, utilisateur: { idUser: number; tentativesEchouees: number }, maintenant: string) {
  const tentatives = utilisateur.tentativesEchouees + 1;
  const verrouille = tentatives >= MAX_TENTATIVES;
  db.update(schema.utilisateur)
    .set({
      tentativesEchouees: verrouille ? 0 : tentatives,
      verrouilleJusqua: verrouille ? new Date(new Date(maintenant).getTime() + DUREE_VERROUILLAGE_MINUTES * 60_000).toISOString() : null,
    })
    .where(eq(schema.utilisateur.idUser, utilisateur.idUser))
    .run();
}
