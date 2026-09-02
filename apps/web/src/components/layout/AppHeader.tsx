import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

const LIBELLES_ROLES: Record<string, string> = {
  ADMINISTRATEUR: "Administrateur",
  GERANT: "Gérant",
  CAISSIER: "Caissier",
  TECHNICIEN_SAV: "Technicien SAV",
  COMPTABLE: "Comptable",
  APPORTEUR: "Apporteur d'affaires",
};

export type Vue = "dashboard" | "caisse" | "sav" | "apporteurs" | "stock";

interface Props {
  vueActive: Vue;
  onNaviguer: (vue: Vue) => void;
  children?: ReactNode;
}

export function AppHeader({ vueActive, onNaviguer, children }: Props) {
  const { session, deconnecter } = useAuth();
  const utilisateur = session!.utilisateur;

  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-border bg-card px-4 py-3">
      <nav aria-label="Navigation principale" className="flex shrink-0 items-center gap-1">
        <Button
          variant={vueActive === "dashboard" ? "default" : "ghost"}
          className="h-9 cursor-pointer"
          aria-current={vueActive === "dashboard" ? "page" : undefined}
          onClick={() => onNaviguer("dashboard")}
        >
          Tableau de bord
        </Button>
        <Button
          variant={vueActive === "caisse" ? "default" : "ghost"}
          className="h-9 cursor-pointer"
          aria-current={vueActive === "caisse" ? "page" : undefined}
          onClick={() => onNaviguer("caisse")}
        >
          Caisse
        </Button>
        <Button
          variant={vueActive === "sav" ? "default" : "ghost"}
          className="h-9 cursor-pointer"
          aria-current={vueActive === "sav" ? "page" : undefined}
          onClick={() => onNaviguer("sav")}
        >
          SAV
        </Button>
        {(utilisateur.role === "ADMINISTRATEUR" || utilisateur.role === "GERANT") && (
          <Button
            variant={vueActive === "apporteurs" ? "default" : "ghost"}
            className="h-9 cursor-pointer"
            aria-current={vueActive === "apporteurs" ? "page" : undefined}
            onClick={() => onNaviguer("apporteurs")}
          >
            Apporteurs
          </Button>
        )}
        {(utilisateur.role === "ADMINISTRATEUR" || utilisateur.role === "GERANT") && (
          <Button
            variant={vueActive === "stock" ? "default" : "ghost"}
            className="h-9 cursor-pointer"
            aria-current={vueActive === "stock" ? "page" : undefined}
            onClick={() => onNaviguer("stock")}
          >
            Stock
          </Button>
        )}
      </nav>

      {children}

      <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          {utilisateur.prenom} {utilisateur.nom} · {LIBELLES_ROLES[utilisateur.role] ?? utilisateur.role}
        </span>
        <Button variant="ghost" size="icon" className="size-9 cursor-pointer" aria-label="Se déconnecter" onClick={deconnecter}>
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
