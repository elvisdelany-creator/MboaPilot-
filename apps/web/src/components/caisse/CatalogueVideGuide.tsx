import { Boxes, Tv } from "lucide-react";
import { peutAccederVue, type RoleUtilisateur } from "@mboapilot/shared";
import { Button } from "@/components/ui/button";
import type { Vue } from "@/components/layout/AppHeader";

interface Props {
  role: string;
  onNaviguer: (vue: Vue) => void;
  onOuvrirCatalogueAdministration: () => void;
}

// Première utilisation d'une boutique : ni formule ni article. « Sélectionnez une catégorie à gauche » n'avait aucun sens
// (il n'y en a pas) et ne disait pas où commencer. Ce guide mène aux écrans où le catalogue se renseigne, pour les seuls
// rôles qui y ont accès ; un caissier est invité à demander à l'encadrement.
export function CatalogueVideGuide({ role, onNaviguer, onOuvrirCatalogueAdministration }: Props) {
  const peutAjouterArticles = peutAccederVue(role as RoleUtilisateur, "stock");
  const peutCreerFormules = peutAccederVue(role as RoleUtilisateur, "administration");

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-5">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">Votre catalogue est vide</h1>
          <p className="mt-1 text-sm text-muted-foreground">Pour commencer à vendre, il faut d'abord renseigner ce que vous vendez.</p>
        </div>

        {(peutAjouterArticles || peutCreerFormules) && (
          <ul className="space-y-4">
            {peutAjouterArticles && (
              <li className="flex items-start gap-3">
                <Boxes className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="space-y-2">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Articles et services</span> : décodeurs, câbles, installation… (vous pouvez aussi importer un fichier CSV).
                  </p>
                  <Button className="min-h-10 cursor-pointer" onClick={() => onNaviguer("stock")}>
                    Ajouter des articles
                  </Button>
                </div>
              </li>
            )}
            {peutCreerFormules && (
              <li className="flex items-start gap-3">
                <Tv className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="space-y-2">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Abonnements</span> : une famille (DSTV, CANAL+…), puis ses formules et ses kits.
                  </p>
                  <Button variant="outline" className="min-h-10 cursor-pointer" onClick={onOuvrirCatalogueAdministration}>
                    Créer les familles et les formules
                  </Button>
                </div>
              </li>
            )}
          </ul>
        )}

        {!peutAjouterArticles && !peutCreerFormules && (
          <p className="text-sm text-foreground">Demandez à un gérant ou à un administrateur de renseigner le catalogue : vous pourrez vendre dès qu'il sera prêt.</p>
        )}
      </div>
    </div>
  );
}
