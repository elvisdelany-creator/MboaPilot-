import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { chargerProfilCourant, ErreurAuthentification, login as loginRequete, renouvelerSessionRequete } from "./api";
import type { Utilisateur } from "./types";

const CLE_SESSION = "mboapilot.session";
// 11.2 : session glissante — une session vaut 12 h, mais tant que l'application reste ouverte elle se renouvelle toutes les
// 30 min : sans cela, un caissier connecté à 8 h était éjecté à 20 h en pleine vente, et son ticket en cours était perdu
const INTERVALLE_RENOUVELLEMENT_MS = 30 * 60 * 1000;

interface Session {
  token: string;
  utilisateur: Utilisateur;
}

interface AuthContextValeur {
  session: Session | null;
  connecter: (identifiant: string, motDePasse: string) => Promise<void>;
  // ouvre une session déjà obtenue (fin de l'assistant d'installation, qui connecte le premier administrateur)
  ouvrirSession: (token: string, utilisateur: Utilisateur) => void;
  deconnecter: () => void;
}

const AuthContext = createContext<AuthContextValeur | null>(null);

function lireSessionStockee(): Session | null {
  try {
    const brut = localStorage.getItem(CLE_SESSION);
    return brut ? (JSON.parse(brut) as Session) : null;
  } catch {
    return null;
  }
}

// 2.5.1 : authentification individuelle obligatoire — aucun compte générique partagé
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(lireSessionStockee);
  const token = session?.token;
  const dernierRenouvellement = useRef(0);

  function ouvrirSession(token: string, utilisateur: Utilisateur) {
    const nouvelleSession = { token, utilisateur };
    dernierRenouvellement.current = Date.now();
    setSession(nouvelleSession);
    localStorage.setItem(CLE_SESSION, JSON.stringify(nouvelleSession));
  }

  async function connecter(identifiant: string, motDePasse: string) {
    const { token, utilisateur } = await loginRequete(identifiant, motDePasse);
    ouvrirSession(token, utilisateur);
  }

  function deconnecter() {
    setSession(null);
    localStorage.removeItem(CLE_SESSION);
  }

  // Le rôle et le site reçus à la connexion sont gardés 12 h dans le navigateur : un gérant rétrogradé
  // pendant sa session voyait encore « Importer CSV » et Administration, avec de faux états vides
  // (« Aucun encaissement aujourd'hui ») au lieu d'un accès refusé. Le profil est donc relu à l'ouverture
  // et à chaque retour sur la fenêtre ; un compte désactivé ou une session expirée ramène à la connexion.
  useEffect(() => {
    if (!token) return;
    let annule = false;

    async function verifierProfil() {
      try {
        const profil = await chargerProfilCourant(token as string);
        if (annule) return;
        setSession((courante) => {
          if (!courante || courante.token !== token) return courante;
          const u = courante.utilisateur;
          const inchange = u.role === profil.role && u.siteId === profil.siteId && u.idApporteur === profil.idApporteur && u.nom === profil.nom && u.prenom === profil.prenom;
          if (inchange) return courante;
          if (u.role !== profil.role || u.siteId !== profil.siteId) toast.info("Vos droits d'accès ont changé : l'application a été mise à jour.");
          const miseAJour = { token: courante.token, utilisateur: profil };
          localStorage.setItem(CLE_SESSION, JSON.stringify(miseAJour));
          return miseAJour;
        });
        if (Date.now() - dernierRenouvellement.current >= INTERVALLE_RENOUVELLEMENT_MS) {
          const renouvelee = await renouvelerSessionRequete(token as string);
          if (annule) return;
          dernierRenouvellement.current = Date.now();
          setSession((courante) => {
            if (!courante || courante.token !== token) return courante;
            const miseAJour = { token: renouvelee.token, utilisateur: courante.utilisateur };
            localStorage.setItem(CLE_SESSION, JSON.stringify(miseAJour));
            return miseAJour;
          });
        }
      } catch (erreur) {
        if (annule || !(erreur instanceof ErreurAuthentification)) return; // une panne réseau ne déconnecte personne
        toast.error("Session expirée — veuillez vous reconnecter.");
        deconnecter();
      }
    }

    verifierProfil();
    window.addEventListener("focus", verifierProfil);
    const minuteur = window.setInterval(verifierProfil, INTERVALLE_RENOUVELLEMENT_MS);
    return () => {
      annule = true;
      window.removeEventListener("focus", verifierProfil);
      window.clearInterval(minuteur);
    };
    // deconnecter ne dépend que de setters stables
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return <AuthContext.Provider value={{ session, connecter, ouvrirSession, deconnecter }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>");
  return ctx;
}
