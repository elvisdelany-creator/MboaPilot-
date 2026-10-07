import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { peutAccederVue, type RoleUtilisateur, type VueApplication } from "@mboapilot/shared";
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

export type Vue = VueApplication;

// ordre d'affichage de la navigation principale ; les écrans proposés dépendent
// du rôle (2.5.1, matrice partagée avec l'API dans packages/shared/acces-vues.ts)
const ONGLETS: { vue: Vue; libelle: string }[] = [
  { vue: "dashboard", libelle: "Tableau de bord" },
  { vue: "caisse", libelle: "Caisse" },
  { vue: "sav", libelle: "SAV" },
  { vue: "clients", libelle: "Clients" },
  { vue: "apporteurs", libelle: "Apporteurs" },
  { vue: "stock", libelle: "Catalogue" },
  { vue: "administration", libelle: "Administration" },
];

interface Props {
  vueActive: Vue;
  onNaviguer: (vue: Vue) => void;
  children?: ReactNode;
}

export function AppHeader({ vueActive, onNaviguer, children }: Props) {
  const { session, deconnecter } = useAuth();
  const utilisateur = session!.utilisateur;

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-3">
      <nav aria-label="Navigation principale" className="flex flex-wrap items-center gap-1">
        {ONGLETS.filter(({ vue }) => peutAccederVue(utilisateur.role as RoleUtilisateur, vue)).map(({ vue, libelle }) => (
          <Button
            key={vue}
            variant={vueActive === vue ? "default" : "ghost"}
            className="h-9 cursor-pointer"
            aria-current={vueActive === vue ? "page" : undefined}
            onClick={() => onNaviguer(vue)}
          >
            {libelle}
          </Button>
        ))}
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
