import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LoginPage } from "@/components/auth/LoginPage";
import { CaissePage } from "@/components/caisse/CaissePage";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import type { Vue } from "@/components/layout/AppHeader";
import type { Abonne, AlerteEcheance } from "@/lib/types";

type EtatVue = { nom: "dashboard" } | { nom: "caisse"; abonneInitial?: Abonne; idFamilleInitiale?: number };

function Contenu() {
  const { session } = useAuth();
  const [vue, setVue] = useState<EtatVue>({ nom: "dashboard" });

  if (!session) return <LoginPage />;

  function naviguer(cible: Vue) {
    setVue(cible === "dashboard" ? { nom: "dashboard" } : { nom: "caisse" });
  }

  function reabonnerDepuisAlerte(alerte: AlerteEcheance) {
    setVue({ nom: "caisse", abonneInitial: alerte.abonne, idFamilleInitiale: alerte.formule.idFamille });
  }

  if (vue.nom === "dashboard") {
    return <DashboardPage onNaviguer={naviguer} onReabonnerDepuisAlerte={reabonnerDepuisAlerte} />;
  }

  return <CaissePage onNaviguer={naviguer} abonneInitial={vue.abonneInitial} idFamilleInitiale={vue.idFamilleInitiale} />;
}

function App() {
  return (
    <AuthProvider>
      <Contenu />
      <Toaster />
    </AuthProvider>
  );
}

export default App;
