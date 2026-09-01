import { createContext, useContext, useState, type ReactNode } from "react";
import { login as loginRequete } from "./api";
import type { Utilisateur } from "./types";

const CLE_SESSION = "mboapilot.session";

interface Session {
  token: string;
  utilisateur: Utilisateur;
}

interface AuthContextValeur {
  session: Session | null;
  connecter: (identifiant: string, motDePasse: string) => Promise<void>;
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

  async function connecter(identifiant: string, motDePasse: string) {
    const { token, utilisateur } = await loginRequete(identifiant, motDePasse);
    const nouvelleSession = { token, utilisateur };
    setSession(nouvelleSession);
    localStorage.setItem(CLE_SESSION, JSON.stringify(nouvelleSession));
  }

  function deconnecter() {
    setSession(null);
    localStorage.removeItem(CLE_SESSION);
  }

  return <AuthContext.Provider value={{ session, connecter, deconnecter }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>");
  return ctx;
}
