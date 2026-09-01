import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LoginPage } from "@/components/auth/LoginPage";
import { CaissePage } from "@/components/caisse/CaissePage";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { SavPage } from "@/components/sav/SavPage";
import type { Vue } from "@/components/layout/AppHeader";
import type { Abonne, AlerteEcheance } from "@/lib/types";

type EtatVue = { nom: "dashboard" } | { nom: "caisse"; abonneInitial?: Abonne; idFamilleInitiale?: number } | { nom: "sav" };

function Contenu() {
  const { session } = useAuth();
  const [vue, setVue] = useState<EtatVue>({ nom: "dashboard" });

  if (!session) return <LoginPage />;

  function naviguer(cible: Vue) {
    setVue({ nom: cible });
  }

  function reabonnerDepuisAlerte(alerte: AlerteEcheance) {
    setVue({ nom: "caisse", abonneInitial: alerte.abonne, idFamilleInitiale: alerte.formule.idFamille });
  }

  if (vue.nom === "dashboard") {
    return <DashboardPage onNaviguer={naviguer} onReabonnerDepuisAlerte={reabonnerDepuisAlerte} />;
  }

  if (vue.nom === "sav") {
    return <SavPage onNaviguer={naviguer} />;
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
