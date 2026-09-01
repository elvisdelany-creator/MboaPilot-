import { Tv, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogueFamille } from "@/lib/types";

interface Props {
  familles: CatalogueFamille[];
  familleSelectionnee: number | null;
  onSelectionner: (idFamille: number) => void;
}

// 5.1 : accès direct aux familles du catalogue (produits, chaque opérateur TV, streaming/IPTV, SAV)
export function CategoriesPanel({ familles, familleSelectionnee, onSelectionner }: Props) {
  return (
    <nav aria-label="Catégories du catalogue" className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto p-3 lg:w-56">
      {familles.map((famille) => {
        const actif = famille.idFamille === familleSelectionnee;
        return (
          <button
            key={famille.idFamille}
            type="button"
            onClick={() => onSelectionner(famille.idFamille)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors",
              actif
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted"
            )}
            aria-pressed={actif}
          >
            {famille.libelle === "STREAMING" ? <Package className="size-4 shrink-0" /> : <Tv className="size-4 shrink-0" />}
            {famille.libelle}
          </button>
        );
      })}
      {familles.length === 0 && (
        <p className="px-3 py-2 text-sm text-muted-foreground">Catalogue vide.</p>
      )}
    </nav>
  );
}
