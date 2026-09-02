import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LoginPage } from "@/components/auth/LoginPage";
import { CaissePage } from "@/components/caisse/CaissePage";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { SavPage } from "@/components/sav/SavPage";
import { ApporteursPage } from "@/components/apporteurs/ApporteursPage";
import { ApporteurFichePage } from "@/components/apporteurs/ApporteurFichePage";
import { StockPage } from "@/components/stock/StockPage";
import type { Vue } from "@/components/layout/AppHeader";
import type { Abonne, AlerteEcheance } from "@/lib/types";

type EtatVue =
  | { nom: "dashboard" }
  | { nom: "caisse"; abonneInitial?: Abonne; idFamilleInitiale?: number }
  | { nom: "sav" }
  | { nom: "apporteurs" }
  | { nom: "stock" };

function Contenu() {
  const { session } = useAuth();
  const [vue, setVue] = useState<EtatVue>({ nom: "dashboard" });

  if (!session) return <LoginPage />;

  // 2.5.1, 6.3 : le rôle APPORTEUR n'a accès qu'à sa propre fiche — les autres
  // routes sont de toute façon bloquées côté serveur, on ne les propose même pas.
  if (session.utilisateur.role === "APPORTEUR") {
    return <ApporteurFichePage />;
  }

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

  if (vue.nom === "apporteurs") {
    return <ApporteursPage onNaviguer={naviguer} />;
  }

  if (vue.nom === "stock") {
    return <StockPage onNaviguer={naviguer} />;
  }

  return <CaissePage onNaviguer={naviguer} abonneInitial={vue.abonneInitial} idFamilleInitiale={vue.idFamilleInitiale} />;
}

// remonte Contenu à chaque changement d'utilisateur connecté (déconnexion
// puis reconnexion sous un autre compte sur le même poste) pour ne jamais
// garder l'écran précédent — potentiellement hors périmètre du nouveau rôle
function ContenuAvecReset() {
  const { session } = useAuth();
  return <Contenu key={session?.utilisateur.idUser ?? "deconnecte"} />;
}

function App() {
  return (
    <AuthProvider>
      <ContenuAvecReset />
      <Toaster />
    </AuthProvider>
  );
}

export default App;
